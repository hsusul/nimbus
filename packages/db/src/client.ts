import { PrismaClient } from "@prisma/client";
import { getDbConfig } from "@nimbus/config";

let prisma: PrismaClient | null = null;

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient({
    datasources: databaseUrl
      ? {
          db: {
            url: databaseUrl,
          },
        }
      : undefined,
  });
}

export function getPrismaClient(): PrismaClient {
  prisma ??= createPrismaClient(getDbConfig().databaseUrl);

  return prisma;
}

export async function disconnectPrismaClient(): Promise<void> {
  if (!prisma) {
    return;
  }

  await prisma.$disconnect();
  prisma = null;
}
