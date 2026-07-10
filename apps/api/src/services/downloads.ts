import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import type { PermissionService, UserPermissionGrant } from "./permission-service";
import type { InternalUser } from "./users";

export type PublicAuditContext = Omit<AuditContext, "actorUserId">;

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
  createPublicFileDownload(
    rawToken: string,
    auditContext: PublicAuditContext,
  ): Promise<FileDownloadDto>;
}

export class PrismaDownloadService implements DownloadService {
  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly options: DownloadServiceOptions,
    private readonly permissionService: PermissionService,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  async createFileDownload(
    actor: InternalUser,
    fileId: string,
    auditContext: AuditContext,
  ): Promise<FileDownloadDto> {
    const grant = await this.permissionService.require(actor, "file.download", {
      resourceType: "file",
      resourceId: fileId,
    });

    return this.createDownload(grant, auditContext);
  }

  async createPublicFileDownload(
    rawToken: string,
    auditContext: PublicAuditContext,
  ): Promise<FileDownloadDto> {
    const grant = await this.permissionService.requirePublic(rawToken, "file.download");
    const download = await this.signCurrentVersion(grant.file);

    await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.update({
        where: { id: grant.shareLink.id },
        data: { useCount: { increment: 1 } },
      });
      await appendAuditLog(tx, {
        ...auditContext,
        actorUserId: grant.shareLink.createdById,
        action: "share_link.accessed",
        resourceType: "file",
        resourceId: grant.file.id,
        metadata: {
          shareLinkId: grant.shareLink.id,
          accessType: "public_download",
          anonymous: true,
        },
      });
      await appendAuditLog(tx, {
        ...auditContext,
        actorUserId: grant.shareLink.createdById,
        action: "file.download_requested",
        resourceType: "file",
        resourceId: grant.file.id,
        metadata: {
          fileVersionId: download.versionId,
          sizeBytes: download.dto.sizeBytes,
          accessSource: "public_link",
          shareLinkId: grant.shareLink.id,
          anonymous: true,
        },
      });
    });

    return download.dto;
  }

  private async createDownload(
    grant: UserPermissionGrant,
    auditContext: AuditContext,
  ): Promise<FileDownloadDto> {
    const download = await this.signCurrentVersion(grant.file);

    await this.prisma.$transaction(async (tx) => {
      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.download_requested",
        resourceType: "file",
        resourceId: grant.file.id,
        metadata: {
          fileVersionId: download.versionId,
          sizeBytes: download.dto.sizeBytes,
          accessSource: grant.accessSource,
          shareId: grant.shareId,
        },
      });
    });

    return download.dto;
  }

  private async signCurrentVersion(file: UserPermissionGrant["file"]): Promise<{
    dto: FileDownloadDto;
    versionId: string;
  }> {
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

    return {
      dto: {
        url: signedDownload.url,
        expiresAt: signedDownload.expiresAt.toISOString(),
        filename: file.name,
        sizeBytes: version.sizeBytes.toString(),
        mimeType: version.mimeType,
      },
      versionId: version.id,
    };
  }
}
