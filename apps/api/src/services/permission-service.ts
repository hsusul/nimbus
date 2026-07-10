import {
  type File,
  getPrismaClient,
  type PrismaClient,
  type Share,
  type ShareLink,
} from "@nimbus/db";
import { createHash } from "node:crypto";

import { HttpError } from "../middleware/error-handler";
import type { InternalUser } from "./users";

export type PermissionAction =
  | "file.read"
  | "file.download"
  | "file.write"
  | "file.delete"
  | "file.share"
  | "file.version.read"
  | "file.version.restore";

export interface ResourceRef {
  resourceType: "file";
  resourceId: string;
}

export interface UserPermissionGrant {
  file: File;
  accessSource: "owner" | "direct_share";
  role: "owner" | "viewer" | "editor";
  shareId: string | null;
}

export interface PublicPermissionGrant {
  file: File;
  shareLink: ShareLink;
  accessSource: "public_link";
  role: "viewer";
}

export interface PermissionService {
  can(actor: InternalUser, action: PermissionAction, resource: ResourceRef): Promise<boolean>;
  require(
    actor: InternalUser,
    action: PermissionAction,
    resource: ResourceRef,
  ): Promise<UserPermissionGrant>;
  requirePublic(
    rawToken: string,
    action: "file.read" | "file.download",
  ): Promise<PublicPermissionGrant>;
}

export class PrismaPermissionService implements PermissionService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async can(
    actor: InternalUser,
    action: PermissionAction,
    resource: ResourceRef,
  ): Promise<boolean> {
    try {
      await this.require(actor, action, resource);
      return true;
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 404) {
        return false;
      }

      throw error;
    }
  }

  async require(
    actor: InternalUser,
    action: PermissionAction,
    resource: ResourceRef,
  ): Promise<UserPermissionGrant> {
    const file = await this.prisma.file.findFirst({
      where: {
        id: resource.resourceId,
        status: "active",
        deletedAt: null,
      },
    });

    if (!file) {
      throw fileNotFound();
    }

    if (file.ownerId === actor.id) {
      return {
        file,
        accessSource: "owner",
        role: "owner",
        shareId: null,
      };
    }

    const share = await this.prisma.share.findFirst({
      where: {
        resourceType: "file",
        resourceId: file.id,
        granteeUserId: actor.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!share || !roleAllows(share, action)) {
      throw fileNotFound();
    }

    return {
      file,
      accessSource: "direct_share",
      role: share.role === "editor" ? "editor" : "viewer",
      shareId: share.id,
    };
  }

  async requirePublic(
    rawToken: string,
    action: "file.read" | "file.download",
  ): Promise<PublicPermissionGrant> {
    if (!rawToken || !publicRoleAllows(action)) {
      throw publicLinkNotFound();
    }

    const shareLink = await this.prisma.shareLink.findFirst({
      where: {
        tokenHash: hashShareLinkToken(rawToken),
        resourceType: "file",
        role: "viewer",
        revokedAt: null,
        createdBy: {
          status: "active",
        },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    if (!shareLink) {
      throw publicLinkNotFound();
    }

    const file = await this.prisma.file.findFirst({
      where: {
        id: shareLink.resourceId,
        ownerId: shareLink.createdById,
        status: "active",
        deletedAt: null,
      },
    });

    if (!file) {
      throw publicLinkNotFound();
    }

    return {
      file,
      shareLink,
      accessSource: "public_link",
      role: "viewer",
    };
  }
}

export function hashShareLinkToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function roleAllows(share: Share, action: PermissionAction): boolean {
  if (share.role === "viewer") {
    return ["file.read", "file.download", "file.version.read"].includes(action);
  }

  if (share.role === "editor") {
    return action !== "file.share";
  }

  return false;
}

function publicRoleAllows(action: PermissionAction): boolean {
  return action === "file.read" || action === "file.download";
}

function fileNotFound(): HttpError {
  return new HttpError(404, "file_not_found", "File was not found.");
}

function publicLinkNotFound(): HttpError {
  return new HttpError(404, "share_link_not_found", "Share link was not found.");
}
