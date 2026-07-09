import type { UploadStartRequest } from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import { buildVersionObjectKey, type ObjectStorageProvider } from "@nimbus/storage";
import { randomUUID } from "node:crypto";

import { HttpError } from "../../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "../audit-log";
import { normalizeResourceName } from "../resource-names";
import type { InternalUser } from "../users";
import {
  assertFileNameAvailable,
  getActiveFolder,
  getCorrelationId,
  parseSizeBytes,
} from "./helpers";
import { chooseUploadPlan } from "./multipart-plan";

export interface UploadServiceOptions {
  bucket: string;
  maxFileSizeBytes: number;
  signedUploadUrlTtlSeconds: number;
  uploadSessionTtlSeconds: number;
  multipartUploadThresholdBytes: number;
  multipartChunkSizeBytes: number;
}

export interface UploadStartResult {
  uploadSessionId: string;
  fileId: string;
  status: string;
  uploadType: "single_part" | "multipart";
  expiresAt: string;
  signedUpload?: {
    url: string;
    method: "PUT";
    expiresAt: string;
    headers: Record<string, string>;
  };
  multipart?: {
    chunkSizeBytes: string;
    partCount: number;
    signedParts: Array<{
      partNumber: number;
      sizeBytes: string;
      url: string;
      method: "PUT";
      expiresAt: string;
      headers: Record<string, string>;
    }>;
  };
}

export async function startUpload(
  actor: InternalUser,
  input: UploadStartRequest,
  auditContext: AuditContext,
  storage: ObjectStorageProvider,
  options: UploadServiceOptions,
  prisma: PrismaClient = getPrismaClient(),
): Promise<UploadStartResult> {
  const name = normalizeResourceName(input.filename);
  const totalSizeBytes = parseSizeBytes(input.totalSizeBytes);
  const requestedChunkSizeBytes =
    input.chunkSizeBytes === undefined ? undefined : parseSizeBytes(input.chunkSizeBytes);
  const expectedSha256 = input.expectedSha256?.toLowerCase();

  if (totalSizeBytes > BigInt(options.maxFileSizeBytes)) {
    throw new HttpError(413, "file_too_large", "File exceeds the configured maximum size.");
  }

  if (requestedChunkSizeBytes !== undefined && requestedChunkSizeBytes <= 0n) {
    throw new HttpError(400, "invalid_chunk_size_bytes", "chunkSizeBytes must be positive.");
  }

  let uploadPlan: ReturnType<typeof chooseUploadPlan>;

  try {
    uploadPlan = chooseUploadPlan({
      totalSizeBytes,
      requestedUploadType: input.uploadType,
      requestedChunkSizeBytes,
      multipartThresholdBytes: options.multipartUploadThresholdBytes,
      defaultChunkSizeBytes: options.multipartChunkSizeBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_multipart_plan";

    throw new HttpError(400, message, "Multipart upload plan is invalid.");
  }

  const fileId = randomUUID();
  const uploadSessionId = randomUUID();
  const plannedVersionId = randomUUID();
  const finalObjectKey = buildVersionObjectKey({
    tenantId: actor.id,
    fileId,
    versionId: plannedVersionId,
  });
  const expiresAt = new Date(Date.now() + options.uploadSessionTtlSeconds * 1000);
  const correlationId = getCorrelationId(auditContext);

  const uploadSession = await prisma.$transaction(async (tx) => {
    await getActiveFolder(tx, actor.id, input.folderId);
    await assertFileNameAvailable(tx, actor.id, input.folderId, name.normalizedName);

    const file = await tx.file.create({
      data: {
        id: fileId,
        ownerId: actor.id,
        folderId: input.folderId,
        name: name.name,
        normalizedName: name.normalizedName,
        extension: name.extension,
        mimeType: input.mimeType,
        status: "uploading",
        sizeBytes: totalSizeBytes,
        contentHash: expectedSha256 ?? null,
      },
    });
    const session = await tx.uploadSession.create({
      data: {
        id: uploadSessionId,
        ownerId: actor.id,
        targetFolderId: input.folderId,
        targetFileId: file.id,
        plannedVersionId,
        uploadMode: "new_file",
        filename: name.name,
        mimeType: input.mimeType,
        totalSizeBytes,
        expectedSha256: expectedSha256 ?? null,
        finalObjectKey,
        bucket: options.bucket,
        uploadType: uploadPlan.uploadType,
        chunkSizeBytes: uploadPlan.chunkSizeBytes,
        receivedBytes: 0n,
        status: "created",
        correlationId,
        expiresAt,
      },
    });

    await appendAuditLog(tx, {
      ...auditContext,
      correlationId,
      action: "upload.started",
      resourceType: "upload_session",
      resourceId: session.id,
      metadata: {
        fileId: file.id,
        folderId: file.folderId,
        filename: file.name,
        sizeBytes: file.sizeBytes.toString(),
        uploadMode: session.uploadMode,
        uploadType: session.uploadType,
        chunkSizeBytes: session.chunkSizeBytes?.toString() ?? null,
        partCount: uploadPlan.partCount,
      },
    });

    return session;
  });

  if (uploadPlan.uploadType === "multipart") {
    const chunkSizeBytes = uploadPlan.chunkSizeBytes;

    if (!chunkSizeBytes) {
      throw new HttpError(500, "invalid_multipart_plan", "Multipart upload is missing chunk size.");
    }

    let multipartUploadId: string;

    try {
      const multipartUpload = await storage.createMultipartUpload({
        bucket: uploadSession.bucket,
        objectKey: uploadSession.finalObjectKey,
        contentType: input.mimeType,
        checksumSha256: expectedSha256,
      });

      multipartUploadId = multipartUpload.uploadId;

      await prisma.uploadSession.update({
        where: {
          id: uploadSession.id,
        },
        data: {
          multipartUploadId,
        },
      });
    } catch (error) {
      await markStartUploadFailed(prisma, uploadSession.id, fileId, "multipart_create_failed");
      throw error;
    }

    const signedParts = await Promise.all(
      Array.from({ length: uploadPlan.partCount }, async (_value, index) => {
        const partNumber = index + 1;
        const signedPart = await storage.createSignedPartUploadUrl({
          bucket: uploadSession.bucket,
          objectKey: uploadSession.finalObjectKey,
          uploadId: multipartUploadId,
          partNumber,
          expiresInSeconds: options.signedUploadUrlTtlSeconds,
        });

        return {
          partNumber,
          sizeBytes: getPartSizeForResponse(totalSizeBytes, chunkSizeBytes, partNumber),
          url: signedPart.url,
          method: "PUT" as const,
          expiresAt: signedPart.expiresAt.toISOString(),
          headers: {},
        };
      }),
    );

    return {
      uploadSessionId: uploadSession.id,
      fileId,
      status: uploadSession.status,
      uploadType: "multipart",
      expiresAt: uploadSession.expiresAt.toISOString(),
      multipart: {
        chunkSizeBytes: chunkSizeBytes.toString(),
        partCount: uploadPlan.partCount,
        signedParts,
      },
    };
  }

  const signedUpload = await storage.createSignedUploadUrl({
    bucket: uploadSession.bucket,
    objectKey: uploadSession.finalObjectKey,
    contentType: input.mimeType,
    contentLength: totalSizeBytes,
    checksumSha256: expectedSha256,
    expiresInSeconds: options.signedUploadUrlTtlSeconds,
  });
  const headers: Record<string, string> = {
    "content-type": input.mimeType,
  };

  if (expectedSha256) {
    headers["x-amz-meta-sha256"] = expectedSha256;
  }

  return {
    uploadSessionId: uploadSession.id,
    fileId,
    status: uploadSession.status,
    uploadType: "single_part",
    expiresAt: uploadSession.expiresAt.toISOString(),
    signedUpload: {
      url: signedUpload.url,
      method: "PUT",
      expiresAt: signedUpload.expiresAt.toISOString(),
      headers,
    },
  };
}

function getPartSizeForResponse(
  totalSizeBytes: bigint,
  chunkSizeBytes: bigint,
  partNumber: number,
): string {
  const fullPartsBytes = chunkSizeBytes * BigInt(partNumber - 1);
  const remainingBytes = totalSizeBytes - fullPartsBytes;

  if (remainingBytes <= chunkSizeBytes) {
    return remainingBytes > 0n ? remainingBytes.toString() : chunkSizeBytes.toString();
  }

  return chunkSizeBytes.toString();
}

async function markStartUploadFailed(
  prisma: PrismaClient,
  uploadSessionId: string,
  fileId: string,
  failureReason: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.uploadSession.update({
      where: {
        id: uploadSessionId,
      },
      data: {
        status: "failed",
        failureReason,
      },
    });
    await tx.file.update({
      where: {
        id: fileId,
      },
      data: {
        status: "failed",
      },
    });
  });
}
