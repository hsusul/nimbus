import type { UploadStartRequest } from "@nimbus/contracts";
import { getPrismaClient, Prisma, type PrismaClient } from "@nimbus/db";
import {
  buildVersionObjectKey,
  ObjectNotFoundError,
  type ObjectMetadata,
  type ObjectStorageProvider,
} from "@nimbus/storage";
import { randomUUID } from "node:crypto";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import { mapFile, type FileDto } from "./files";
import { normalizeResourceName } from "./resource-names";
import type { InternalUser } from "./users";

type TransactionClient = Prisma.TransactionClient;

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

export interface UploadService {
  startSinglePartUpload(
    actor: InternalUser,
    input: UploadStartRequest,
    auditContext: AuditContext,
  ): Promise<UploadStartResult>;
  completeSinglePartUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<FileDto>;
}

export class PrismaUploadService implements UploadService {
  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly options: UploadServiceOptions,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  async startSinglePartUpload(
    actor: InternalUser,
    input: UploadStartRequest,
    auditContext: AuditContext,
  ): Promise<UploadStartResult> {
    const name = normalizeResourceName(input.filename);
    const totalSizeBytes = parseSizeBytes(input.totalSizeBytes);
    const expectedSha256 = input.expectedSha256?.toLowerCase();

    if (totalSizeBytes > BigInt(this.options.maxFileSizeBytes)) {
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
    const expiresAt = new Date(Date.now() + this.options.uploadSessionTtlSeconds * 1000);

    const uploadSession = await this.prisma.$transaction(async (tx) => {
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
          bucket: this.options.bucket,
          status: "created",
          expiresAt,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
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
    const signedUpload = await this.storage.createSignedUploadUrl({
      bucket: uploadSession.bucket,
      objectKey: uploadSession.finalObjectKey,
      contentType: input.mimeType,
      contentLength: totalSizeBytes,
      expiresInSeconds: this.options.signedUploadUrlTtlSeconds,
    });

    return {
      uploadSessionId: uploadSession.id,
      fileId,
      status: uploadSession.status,
      expiresAt: uploadSession.expiresAt.toISOString(),
      signedUpload: {
        url: signedUpload.url,
        method: "PUT",
        expiresAt: signedUpload.expiresAt.toISOString(),
        headers: {
          "content-type": input.mimeType,
        },
      },
    };
  }

  async completeSinglePartUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<FileDto> {
    const uploadSession = await this.prisma.uploadSession.findFirst({
      where: {
        id: uploadSessionId,
        ownerId: actor.id,
      },
    });

    if (!uploadSession) {
      throw new HttpError(404, "upload_session_not_found", "Upload session was not found.");
    }

    assertCompletableUploadSession(uploadSession.status);

    if (uploadSession.expiresAt.getTime() <= Date.now()) {
      await this.markUploadFailed(
        uploadSession.id,
        uploadSession.targetFileId,
        "upload_session_expired",
      );
      throw new HttpError(410, "upload_session_expired", "Upload session has expired.");
    }

    const objectMetadata = await this.headUploadedObject(uploadSession);
    const metadataSha256 = getHeadSha256(objectMetadata);

    if (objectMetadata.sizeBytes !== uploadSession.totalSizeBytes) {
      await this.markUploadFailed(uploadSession.id, uploadSession.targetFileId, "size_mismatch");
      throw new HttpError(409, "size_mismatch", "Uploaded object size does not match the session.");
    }

    if (
      uploadSession.expectedSha256 &&
      metadataSha256 &&
      uploadSession.expectedSha256 !== metadataSha256
    ) {
      await this.markUploadFailed(uploadSession.id, uploadSession.targetFileId, "sha256_mismatch");
      throw new HttpError(409, "sha256_mismatch", "Uploaded object checksum does not match.");
    }

    return this.prisma.$transaction(async (tx) => {
      const lockedSession = await tx.uploadSession.findFirst({
        where: {
          id: uploadSession.id,
          ownerId: actor.id,
        },
      });

      if (!lockedSession) {
        throw new HttpError(404, "upload_session_not_found", "Upload session was not found.");
      }

      assertCompletableUploadSession(lockedSession.status);

      if (!lockedSession.targetFileId) {
        throw new HttpError(
          409,
          "upload_session_invalid",
          "Upload session is missing a file target.",
        );
      }

      const existingVersion = await tx.fileVersion.findUnique({
        where: {
          uploadSessionId: lockedSession.id,
        },
      });

      if (existingVersion) {
        throw new HttpError(
          409,
          "upload_already_completed",
          "Upload session is already completed.",
        );
      }

      const versionNumber = await getNextVersionNumber(tx, lockedSession.targetFileId);
      const fileVersion = await tx.fileVersion.create({
        data: {
          id: lockedSession.plannedVersionId,
          fileId: lockedSession.targetFileId,
          versionNumber,
          storageProvider: "s3-compatible",
          bucket: lockedSession.bucket,
          objectKey: lockedSession.finalObjectKey,
          sizeBytes: objectMetadata.sizeBytes,
          sha256: lockedSession.expectedSha256 ?? metadataSha256,
          etag: objectMetadata.etag,
          mimeType: lockedSession.mimeType,
          uploadSessionId: lockedSession.id,
          createdById: actor.id,
          processingStatus: "available",
        },
      });
      const file = await tx.file.update({
        where: {
          id: lockedSession.targetFileId,
        },
        data: {
          status: "active",
          currentVersionId: fileVersion.id,
          sizeBytes: objectMetadata.sizeBytes,
          contentHash: fileVersion.sha256,
          mimeType: lockedSession.mimeType,
        },
      });

      await tx.uploadSession.update({
        where: {
          id: lockedSession.id,
        },
        data: {
          status: "completed",
          completedAt: new Date(),
          failureReason: null,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "upload.completed",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          uploadSessionId: lockedSession.id,
          fileVersionId: fileVersion.id,
          sizeBytes: fileVersion.sizeBytes.toString(),
        },
      });

      return mapFile(file);
    });
  }

  private async headUploadedObject(uploadSession: {
    bucket: string;
    finalObjectKey: string;
    id: string;
    targetFileId: string | null;
  }): Promise<ObjectMetadata> {
    try {
      return await this.storage.headObject({
        bucket: uploadSession.bucket,
        objectKey: uploadSession.finalObjectKey,
      });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        await this.markUploadFailed(uploadSession.id, uploadSession.targetFileId, "object_missing");
        throw new HttpError(409, "object_missing", "Uploaded object was not found.");
      }

      throw error;
    }
  }

  private async markUploadFailed(
    uploadSessionId: string,
    targetFileId: string | null,
    failureReason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.uploadSession.update({
        where: {
          id: uploadSessionId,
        },
        data: {
          status: "failed",
          failureReason,
        },
      });

      if (targetFileId) {
        await tx.file.update({
          where: {
            id: targetFileId,
          },
          data: {
            status: "failed",
          },
        });
      }
    });
  }
}

async function getActiveFolder(
  tx: PrismaClient | TransactionClient,
  ownerId: string,
  folderId: string,
) {
  const folder = await tx.folder.findFirst({
    where: {
      id: folderId,
      ownerId,
      deletedAt: null,
    },
  });

  if (!folder) {
    throw new HttpError(404, "folder_not_found", "Folder was not found.");
  }

  return folder;
}

async function assertFileNameAvailable(
  tx: TransactionClient,
  ownerId: string,
  folderId: string,
  normalizedName: string,
) {
  const existingFile = await tx.file.findFirst({
    where: {
      ownerId,
      folderId,
      normalizedName,
      status: {
        in: ["active", "uploading"],
      },
      deletedAt: null,
    },
  });

  if (existingFile) {
    throw new HttpError(409, "duplicate_file_name", "File name already exists in this folder.");
  }
}

async function getNextVersionNumber(tx: TransactionClient, fileId: string): Promise<number> {
  const latestVersion = await tx.fileVersion.findFirst({
    where: {
      fileId,
    },
    orderBy: {
      versionNumber: "desc",
    },
  });

  return (latestVersion?.versionNumber ?? 0) + 1;
}

function assertCompletableUploadSession(status: string) {
  if (status === "completed") {
    throw new HttpError(409, "upload_already_completed", "Upload session is already completed.");
  }

  if (["failed", "canceled", "expired"].includes(status)) {
    throw new HttpError(409, "upload_not_completable", "Upload session cannot be completed.");
  }
}

function parseSizeBytes(value: UploadStartRequest["totalSizeBytes"]): bigint {
  const sizeBytes = BigInt(value);

  if (sizeBytes < 0n) {
    throw new HttpError(400, "invalid_size_bytes", "totalSizeBytes must be non-negative.");
  }

  return sizeBytes;
}

function getHeadSha256(metadata: ObjectMetadata): string | null {
  return metadata.metadata["sha256"] ?? metadata.metadata["nimbus-sha256"] ?? null;
}
