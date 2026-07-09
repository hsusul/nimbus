import type { AuthenticatedUser } from "@nimbus/auth";
import { getPrismaClient, type PrismaClient, type User } from "@nimbus/db";

export interface InternalUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  storageQuotaBytes: bigint;
  storageUsedBytes: bigint;
}

export interface UserService {
  ensureUser(identity: AuthenticatedUser): Promise<InternalUser>;
}

export class PrismaUserService implements UserService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async ensureUser(identity: AuthenticatedUser): Promise<InternalUser> {
    const user = await this.prisma.user.upsert({
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

    return mapUser(user);
  }
}

export function mapUser(user: User): InternalUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email,
    status: user.status,
    storageQuotaBytes: user.storageQuotaBytes,
    storageUsedBytes: user.storageUsedBytes,
  };
}
