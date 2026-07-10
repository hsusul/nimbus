import type { ShareLinkCreateRequest } from "@nimbus/contracts";
import { type ShareLink, getPrismaClient, type PrismaClient } from "@nimbus/db";
import { randomBytes } from "node:crypto";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import type { DownloadService, FileDownloadDto, PublicAuditContext } from "./downloads";
import { hashShareLinkToken, type PermissionService } from "./permission-service";
import type { InternalUser } from "./users";

export interface ShareLinkDto {
  id: string;
  resourceType: "file";
  resourceId: string;
  role: "viewer";
  expiresAt: string | null;
  revokedAt: string | null;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicShareDto {
  resource: {
    resourceType: "file";
    resourceId: string;
    name: string;
    mimeType: string | null;
    sizeBytes: string;
    updatedAt: string;
  };
  download?: FileDownloadDto;
}

export interface ShareLinkService {
  createShareLink(
    actor: InternalUser,
    input: ShareLinkCreateRequest,
    auditContext: AuditContext,
  ): Promise<{ shareLink: ShareLinkDto; token: string }>;
  getShareLink(actor: InternalUser, shareLinkId: string): Promise<ShareLinkDto>;
  revokeShareLink(
    actor: InternalUser,
    shareLinkId: string,
    auditContext: AuditContext,
  ): Promise<ShareLinkDto>;
  getPublicShare(
    rawToken: string,
    includeDownload: boolean,
    auditContext: PublicAuditContext,
  ): Promise<PublicShareDto>;
}

export class PrismaShareLinkService implements ShareLinkService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly downloadService: DownloadService,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  async createShareLink(
    actor: InternalUser,
    input: ShareLinkCreateRequest,
    auditContext: AuditContext,
  ): Promise<{ shareLink: ShareLinkDto; token: string }> {
    await this.permissionService.require(actor, "file.share", {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    });

    const rawToken = generateShareLinkToken();
    const shareLink = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shareLink.create({
        data: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          tokenHash: hashShareLinkToken(rawToken),
          role: "viewer",
          createdById: actor.id,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "share_link.created",
        resourceType: "file",
        resourceId: input.resourceId,
        metadata: {
          shareLinkId: created.id,
          role: created.role,
        },
      });

      return created;
    });

    return {
      shareLink: mapShareLink(shareLink),
      token: rawToken,
    };
  }

  async getShareLink(actor: InternalUser, shareLinkId: string): Promise<ShareLinkDto> {
    const shareLink = await this.prisma.shareLink.findFirst({
      where: { id: shareLinkId, createdById: actor.id },
    });

    if (!shareLink || shareLink.resourceType !== "file") {
      throw new HttpError(404, "share_link_not_found", "Share link was not found.");
    }

    return mapShareLink(shareLink);
  }

  async revokeShareLink(
    actor: InternalUser,
    shareLinkId: string,
    auditContext: AuditContext,
  ): Promise<ShareLinkDto> {
    return this.prisma.$transaction(async (tx) => {
      const shareLink = await tx.shareLink.findFirst({
        where: { id: shareLinkId, createdById: actor.id },
      });

      if (!shareLink || shareLink.resourceType !== "file") {
        throw new HttpError(404, "share_link_not_found", "Share link was not found.");
      }

      const revoked = shareLink.revokedAt
        ? shareLink
        : await tx.shareLink.update({
            where: { id: shareLink.id },
            data: { revokedAt: new Date() },
          });

      if (!shareLink.revokedAt) {
        await appendAuditLog(tx, {
          ...auditContext,
          action: "share_link.revoked",
          resourceType: "file",
          resourceId: shareLink.resourceId,
          metadata: { shareLinkId: shareLink.id },
        });
      }

      return mapShareLink(revoked);
    });
  }

  async getPublicShare(
    rawToken: string,
    includeDownload: boolean,
    auditContext: PublicAuditContext,
  ): Promise<PublicShareDto> {
    const grant = await this.permissionService.requirePublic(rawToken, "file.read");
    const download = includeDownload
      ? await this.downloadService.createPublicFileDownload(rawToken, auditContext)
      : undefined;

    if (!includeDownload) {
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
            accessType: "public_metadata",
            anonymous: true,
          },
        });
      });
    }

    return {
      resource: {
        resourceType: "file",
        resourceId: grant.file.id,
        name: grant.file.name,
        mimeType: grant.file.mimeType,
        sizeBytes: grant.file.sizeBytes.toString(),
        updatedAt: grant.file.updatedAt.toISOString(),
      },
      ...(download ? { download } : {}),
    };
  }
}

export function generateShareLinkToken(): string {
  return randomBytes(32).toString("base64url");
}

function mapShareLink(shareLink: ShareLink): ShareLinkDto {
  return {
    id: shareLink.id,
    resourceType: "file",
    resourceId: shareLink.resourceId,
    role: "viewer",
    expiresAt: shareLink.expiresAt?.toISOString() ?? null,
    revokedAt: shareLink.revokedAt?.toISOString() ?? null,
    useCount: shareLink.useCount,
    createdAt: shareLink.createdAt.toISOString(),
    updatedAt: shareLink.updatedAt.toISOString(),
  };
}
