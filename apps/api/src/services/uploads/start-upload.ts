import type { UploadStartRequest } from "@nimbus/contracts";
import { buildFileSearchDocument, getPrismaClient, Prisma, type PrismaClient } from "@nimbus/db";
import { buildVersionObjectKey, type ObjectStorageProvider } from "@nimbus/storage";
import { randomUUID } from "node:crypto";

import { HttpError } from "../../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "../audit-log";
import { normalizeResourceName } from "../resource-names";
import type { PermissionService } from "../permission-service";
import type { InternalUser } from "../users";
import {
  assertFileNameAvailable,
  getActiveFolder,
  getCorrelationId,
  parseSizeBytes,
} from "./helpers";
import { chooseUploadPlan } from "./multipart-plan";

type TransactionClient = Prisma.TransactionClient;

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
  uploadMode: "new_file" | "new_version";
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
  permissionService: PermissionService,
  prisma: PrismaClient = getPrismaClient(),
): Promise<UploadStartResult> {
  const uploadMode = input.uploadMode;
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

  const versionGrant =
    uploadMode === "new_version" && input.targetFileId
      ? await permissionService.require(actor, "file.write", {
          resourceType: "file",
          resourceId: input.targetFileId,
        })
      : null;
  const fileId = uploadMode === "new_version" ? input.targetFileId : randomUUID();

  if (!fileId) {
    throw new HttpError(400, "target_file_required", "targetFileId is required.");
  }

  const uploadSessionId = randomUUID();
  const plannedVersionId = randomUUID();
  const finalObjectKey = buildVersionObjectKey({
    tenantId: versionGrant?.file.ownerId ?? actor.id,
    fileId,
    versionId: plannedVersionId,
  });
  const expiresAt = new Date(Date.now() + options.uploadSessionTtlSeconds * 1000);
  const correlationId = getCorrelationId(auditContext);

  const uploadSession = await prisma.$transaction(async (tx) => {
    if (uploadMode === "new_file") {
      if (!input.folderId || !input.filename) {
        throw new HttpError(
          400,
          "new_file_upload_target_required",
          "folderId and filename are required for new file uploads.",
        );
      }

      const name = normalizeResourceName(input.filename);

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
          searchDocument: buildFileSearchDocument({
            name: name.name,
            extension: name.extension,
            mimeType: input.mimeType,
          }),
        },
      });
      const session = await createUploadSession(tx, {
        uploadSessionId,
        ownerId: actor.id,
        targetFolderId: file.folderId,
        targetFileId: file.id,
        plannedVersionId,
        uploadMode,
        filename: file.name,
        mimeType: input.mimeType,
        totalSizeBytes,
        expectedSha256,
        finalObjectKey,
        bucket: options.bucket,
        uploadType: uploadPlan.uploadType,
        chunkSizeBytes: uploadPlan.chunkSizeBytes,
        correlationId,
        expiresAt,
      });

      await writeUploadStartedAudit(tx, auditContext, correlationId, session, {
        fileId: file.id,
        folderId: file.folderId,
        filename: file.name,
        sizeBytes: file.sizeBytes.toString(),
        partCount: uploadPlan.partCount,
      });

      return session;
    }

    const targetFile = await tx.file.findFirst({
      where: {
        id: fileId,
        ownerId: versionGrant?.file.ownerId,
        status: "active",
        deletedAt: null,
      },
    });

    if (!targetFile) {
      throw new HttpError(404, "file_not_found", "File was not found.");
    }

    const session = await createUploadSession(tx, {
      uploadSessionId,
      ownerId: actor.id,
      targetFolderId: targetFile.folderId,
      targetFileId: targetFile.id,
      plannedVersionId,
      uploadMode,
      filename: targetFile.name,
      mimeType: input.mimeType,
      totalSizeBytes,
      expectedSha256,
      finalObjectKey,
      bucket: options.bucket,
      uploadType: uploadPlan.uploadType,
      chunkSizeBytes: uploadPlan.chunkSizeBytes,
      correlationId,
      expiresAt,
    });

    await writeUploadStartedAudit(tx, auditContext, correlationId, session, {
      fileId: targetFile.id,
      folderId: targetFile.folderId,
      filename: targetFile.name,
      sizeBytes: totalSizeBytes.toString(),
      partCount: uploadPlan.partCount,
    });

    return session;
  });

  if (!uploadSession.targetFileId) {
    throw new HttpError(500, "upload_session_invalid", "Upload session is missing a file target.");
  }

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
      await markStartUploadFailed(
        prisma,
        uploadSession.id,
        uploadSession.targetFileId,
        "multipart_create_failed",
        uploadSession.uploadMode === "new_file",
      );
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
      fileId: uploadSession.targetFileId,
      uploadMode: uploadSession.uploadMode === "new_version" ? "new_version" : "new_file",
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
    fileId: uploadSession.targetFileId,
    uploadMode: uploadSession.uploadMode === "new_version" ? "new_version" : "new_file",
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

async function createUploadSession(
  tx: TransactionClient,
  input: {
    uploadSessionId: string;
    ownerId: string;
    targetFolderId: string;
    targetFileId: string;
    plannedVersionId: string;
    uploadMode: "new_file" | "new_version";
    filename: string;
    mimeType: string;
    totalSizeBytes: bigint;
    expectedSha256?: string | null;
    finalObjectKey: string;
    bucket: string;
    uploadType: "single_part" | "multipart";
    chunkSizeBytes: bigint | null;
    correlationId: string;
    expiresAt: Date;
  },
) {
  return tx.uploadSession.create({
    data: {
      id: input.uploadSessionId,
      ownerId: input.ownerId,
      targetFolderId: input.targetFolderId,
      targetFileId: input.targetFileId,
      plannedVersionId: input.plannedVersionId,
      uploadMode: input.uploadMode,
      filename: input.filename,
      mimeType: input.mimeType,
      totalSizeBytes: input.totalSizeBytes,
      expectedSha256: input.expectedSha256 ?? null,
      finalObjectKey: input.finalObjectKey,
      bucket: input.bucket,
      uploadType: input.uploadType,
      chunkSizeBytes: input.chunkSizeBytes,
      receivedBytes: 0n,
      status: "created",
      correlationId: input.correlationId,
      expiresAt: input.expiresAt,
    },
  });
}

async function writeUploadStartedAudit(
  tx: TransactionClient,
  auditContext: AuditContext,
  correlationId: string,
  session: {
    id: string;
    uploadMode: string;
    uploadType: string;
    chunkSizeBytes: bigint | null;
  },
  metadata: {
    fileId: string;
    folderId: string;
    filename: string;
    sizeBytes: string;
    partCount: number;
  },
) {
  await appendAuditLog(tx, {
    ...auditContext,
    correlationId,
    action: "upload.started",
    resourceType: "upload_session",
    resourceId: session.id,
    metadata: {
      fileId: metadata.fileId,
      folderId: metadata.folderId,
      filename: metadata.filename,
      sizeBytes: metadata.sizeBytes,
      uploadMode: session.uploadMode,
      uploadType: session.uploadType,
      chunkSizeBytes: session.chunkSizeBytes?.toString() ?? null,
      partCount: metadata.partCount,
    },
  });
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
  failTargetFile: boolean,
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

    if (failTargetFile) {
      await tx.file.update({
        where: {
          id: fileId,
        },
        data: {
          status: "failed",
        },
      });
    }
  });
}
