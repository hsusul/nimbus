import type { PrismaClient } from "@prisma/client";

import { getPrismaClient } from "./client";

export async function checkDatabase(prisma: PrismaClient = getPrismaClient()): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
