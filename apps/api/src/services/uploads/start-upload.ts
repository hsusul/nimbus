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

export interface UploadServiceOptions {
  bucket: string;
  maxFileSizeBytes: number;
  signedUploadUrlTtlSeconds: number;
  uploadSessionTtlSeconds: number;
}

export interface UploadStartResult {
  uploadSessionId: string;
  fileId: string;
  status: string;
  expiresAt: string;
  signedUpload: {
    url: string;
    method: "PUT";
    expiresAt: string;
    headers: Record<string, string>;
  };
}

export async function startSinglePartUpload(
  actor: InternalUser,
  input: UploadStartRequest,
  auditContext: AuditContext,
  storage: ObjectStorageProvider,
  options: UploadServiceOptions,
  prisma: PrismaClient = getPrismaClient(),
): Promise<UploadStartResult> {
  const name = normalizeResourceName(input.filename);
  const totalSizeBytes = parseSizeBytes(input.totalSizeBytes);
  const expectedSha256 = input.expectedSha256?.toLowerCase();

  if (totalSizeBytes > BigInt(options.maxFileSizeBytes)) {
    throw new HttpError(413, "file_too_large", "File exceeds the configured maximum size.");
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
        singlePart: true,
      },
    });

    return session;
  });
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
    expiresAt: uploadSession.expiresAt.toISOString(),
    signedUpload: {
      url: signedUpload.url,
      method: "PUT",
      expiresAt: signedUpload.expiresAt.toISOString(),
      headers,
    },
  };
}
