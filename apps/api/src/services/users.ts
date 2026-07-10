import type { AuthenticatedUser } from "@nimbus/auth";
import {
  buildFolderSearchDocument,
  getPrismaClient,
  Prisma,
  type PrismaClient,
  type User,
} from "@nimbus/db";

import { normalizeResourceName } from "./resource-names";

export interface InternalUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  storageQuotaBytes: bigint;
  storageUsedBytes: bigint;
  rootFolderId: string;
}

export interface UserService {
  ensureUser(identity: AuthenticatedUser): Promise<InternalUser>;
}

export class PrismaUserService implements UserService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async ensureUser(identity: AuthenticatedUser): Promise<InternalUser> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: {
          authSubject: identity.authSubject,
        },
        create: {
          authSubject: identity.authSubject,
          email: identity.email,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          lastLoginAt: new Date(),
        },
        update: {
          email: identity.email,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
      const rootFolderId = await ensureRootFolder(tx, user.id);

      return mapUser(user, rootFolderId);
    });
  }
}

export function mapUser(user: User, rootFolderId: string): InternalUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email,
    status: user.status,
    storageQuotaBytes: user.storageQuotaBytes,
    storageUsedBytes: user.storageUsedBytes,
    rootFolderId,
  };
}

async function ensureRootFolder(tx: Prisma.TransactionClient, ownerId: string): Promise<string> {
  const existingRoot = await tx.folder.findFirst({
    where: {
      ownerId,
      parentFolderId: null,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (existingRoot) {
    return existingRoot.id;
  }

  const rootName = normalizeResourceName("Root");
  const rootFolder = await tx.folder.create({
    data: {
      ownerId,
      parentFolderId: null,
      name: rootName.name,
      normalizedName: rootName.normalizedName,
      depth: 0,
      status: "active",
      searchDocument: buildFolderSearchDocument(rootName.name),
    },
    select: {
      id: true,
    },
  });

  return rootFolder.id;
}
