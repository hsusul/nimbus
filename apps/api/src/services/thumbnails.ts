import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import type { PermissionService } from "./permission-service";
import type { InternalUser } from "./users";

export interface ThumbnailDownloadDto {
  url: string;
  expiresAt: string;
  fileId: string;
  fileVersionId: string;
  mimeType: "image/webp";
  width: number;
  height: number;
  sizeBytes: string;
}

export interface ThumbnailService {
  createThumbnailDownload(
    actor: InternalUser,
    fileId: string,
    auditContext: AuditContext,
  ): Promise<ThumbnailDownloadDto>;
}

export class PrismaThumbnailService implements ThumbnailService {
  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly permissionService: PermissionService,
    private readonly signedUrlTtlSeconds: number,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  async createThumbnailDownload(
    actor: InternalUser,
    fileId: string,
    auditContext: AuditContext,
  ): Promise<ThumbnailDownloadDto> {
    const grant = await this.permissionService.require(actor, "file.read", {
      resourceType: "file",
      resourceId: fileId,
    });

    if (!grant.file.currentVersionId) {
      throw thumbnailNotAvailable();
    }

    const thumbnail = await this.prisma.thumbnail.findFirst({
      where: {
        fileId: grant.file.id,
        fileVersionId: grant.file.currentVersionId,
        status: "complete",
        bucket: { not: null },
        objectKey: { not: null },
        width: { not: null },
        height: { not: null },
        sizeBytes: { not: null },
      },
    });

    if (
      !thumbnail ||
      !thumbnail.bucket ||
      !thumbnail.objectKey ||
      !thumbnail.width ||
      !thumbnail.height ||
      thumbnail.sizeBytes === null
    ) {
      throw thumbnailNotAvailable();
    }

    const signed = await this.storage.createSignedDownloadUrl({
      bucket: thumbnail.bucket,
      objectKey: thumbnail.objectKey,
      filename: `${grant.file.name}.thumbnail.webp`,
      contentType: "image/webp",
      expiresInSeconds: this.signedUrlTtlSeconds,
    });

    await this.prisma.$transaction(async (tx) => {
      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.thumbnail_requested",
        resourceType: "file",
        resourceId: grant.file.id,
        metadata: {
          fileVersionId: thumbnail.fileVersionId,
          thumbnailId: thumbnail.id,
          accessSource: grant.accessSource,
        },
      });
    });

    return {
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      fileId: grant.file.id,
      fileVersionId: thumbnail.fileVersionId,
      mimeType: "image/webp",
      width: thumbnail.width,
      height: thumbnail.height,
      sizeBytes: thumbnail.sizeBytes.toString(),
    };
  }
}

function thumbnailNotAvailable() {
  return new HttpError(404, "thumbnail_not_found", "Thumbnail was not found.");
}
