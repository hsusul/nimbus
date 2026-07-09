import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import type { InternalUser } from "./users";

export interface DownloadServiceOptions {
  signedDownloadUrlTtlSeconds: number;
}

export interface FileDownloadDto {
  url: string;
  expiresAt: string;
  filename: string;
  sizeBytes: string;
  mimeType: string;
}

export interface DownloadService {
  createFileDownload(
    actor: InternalUser,
    fileId: string,
    auditContext: AuditContext,
  ): Promise<FileDownloadDto>;
}

export class PrismaDownloadService implements DownloadService {
  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly options: DownloadServiceOptions,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  async createFileDownload(
    actor: InternalUser,
    fileId: string,
    auditContext: AuditContext,
  ): Promise<FileDownloadDto> {
    const file = await this.prisma.file.findFirst({
      where: {
        id: fileId,
        ownerId: actor.id,
        deletedAt: null,
        status: "active",
      },
    });

    if (!file) {
      throw new HttpError(404, "file_not_found", "File was not found.");
    }

    if (!file.currentVersionId) {
      throw new HttpError(409, "file_not_available", "File does not have an available version.");
    }

    const version = await this.prisma.fileVersion.findFirst({
      where: {
        id: file.currentVersionId,
        fileId: file.id,
        processingStatus: "available",
      },
    });

    if (!version) {
      throw new HttpError(409, "file_not_available", "File does not have an available version.");
    }

    const signedDownload = await this.storage.createSignedDownloadUrl({
      bucket: version.bucket,
      objectKey: version.objectKey,
      filename: file.name,
      contentType: version.mimeType,
      expiresInSeconds: this.options.signedDownloadUrlTtlSeconds,
    });

    await this.prisma.$transaction(async (tx) => {
      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.download_requested",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          fileVersionId: version.id,
          sizeBytes: version.sizeBytes.toString(),
        },
      });
    });

    return {
      url: signedDownload.url,
      expiresAt: signedDownload.expiresAt.toISOString(),
      filename: file.name,
      sizeBytes: version.sizeBytes.toString(),
      mimeType: version.mimeType,
    };
  }
}
