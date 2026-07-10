import type { ShareCreateRequest } from "@nimbus/contracts";
import { type Share, getPrismaClient, Prisma, type PrismaClient, type User } from "@nimbus/db";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import type { PermissionService } from "./permission-service";
import type { InternalUser } from "./users";

export interface ShareDto {
  id: string;
  resourceType: "file";
  resourceId: string;
  grantee: {
    userId: string;
    email: string;
    displayName: string;
  };
  role: "viewer" | "editor";
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShareService {
  createShare(
    actor: InternalUser,
    input: ShareCreateRequest,
    auditContext: AuditContext,
  ): Promise<ShareDto>;
  listShares(actor: InternalUser, resourceType: "file", resourceId: string): Promise<ShareDto[]>;
  revokeShare(actor: InternalUser, shareId: string, auditContext: AuditContext): Promise<ShareDto>;
}

export class PrismaShareService implements ShareService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  async createShare(
    actor: InternalUser,
    input: ShareCreateRequest,
    auditContext: AuditContext,
  ): Promise<ShareDto> {
    await this.permissionService.require(actor, "file.share", {
      resourceType: input.resourceType,
      resourceId: input.resourceId,
    });

    return this.prisma.$transaction(async (tx) => {
      const grantee = await tx.user.findFirst({
        where: {
          email: input.granteeEmail.trim().toLowerCase(),
          status: "active",
        },
      });

      if (!grantee) {
        throw new HttpError(404, "share_grantee_not_found", "Share recipient was not found.");
      }

      if (grantee.id === actor.id) {
        throw new HttpError(
          409,
          "cannot_share_with_owner",
          "A resource owner cannot share with themselves.",
        );
      }

      const existingShare = await tx.share.findFirst({
        where: {
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          granteeUserId: grantee.id,
          revokedAt: null,
        },
      });

      if (existingShare) {
        throw new HttpError(
          409,
          "share_already_exists",
          "An active share already exists for this user.",
        );
      }

      let share: Share;
      try {
        share = await tx.share.create({
          data: {
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            granteeUserId: grantee.id,
            role: input.role,
            createdById: actor.id,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new HttpError(
            409,
            "share_already_exists",
            "An active share already exists for this user.",
          );
        }
        throw error;
      }

      await appendAuditLog(tx, {
        ...auditContext,
        action: "share.created",
        resourceType: "file",
        resourceId: input.resourceId,
        targetUserId: grantee.id,
        metadata: {
          shareId: share.id,
          role: share.role,
        },
      });

      return mapShare(share, grantee);
    });
  }

  async listShares(
    actor: InternalUser,
    resourceType: "file",
    resourceId: string,
  ): Promise<ShareDto[]> {
    await this.permissionService.require(actor, "file.share", { resourceType, resourceId });
    const shares = await this.prisma.share.findMany({
      where: { resourceType, resourceId },
      include: { grantee: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    return shares.map((share) => mapShare(share, share.grantee));
  }

  async revokeShare(
    actor: InternalUser,
    shareId: string,
    auditContext: AuditContext,
  ): Promise<ShareDto> {
    return this.prisma.$transaction(async (tx) => {
      const share = await tx.share.findFirst({
        where: {
          id: shareId,
          createdById: actor.id,
        },
        include: { grantee: true },
      });

      if (!share || share.resourceType !== "file") {
        throw new HttpError(404, "share_not_found", "Share was not found.");
      }

      const revokedShare = share.revokedAt
        ? share
        : await tx.share.update({
            where: { id: share.id },
            data: { revokedAt: new Date() },
            include: { grantee: true },
          });

      if (!share.revokedAt) {
        await appendAuditLog(tx, {
          ...auditContext,
          action: "share.revoked",
          resourceType: "file",
          resourceId: share.resourceId,
          targetUserId: share.granteeUserId,
          metadata: {
            shareId: share.id,
            role: share.role,
          },
        });
      }

      return mapShare(revokedShare, revokedShare.grantee);
    });
  }
}

function mapShare(share: Share, grantee: User): ShareDto {
  return {
    id: share.id,
    resourceType: "file",
    resourceId: share.resourceId,
    grantee: {
      userId: grantee.id,
      email: grantee.email,
      displayName: grantee.displayName ?? grantee.email,
    },
    role: share.role === "editor" ? "editor" : "viewer",
    expiresAt: share.expiresAt?.toISOString() ?? null,
    revokedAt: share.revokedAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
  };
}
