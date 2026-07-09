export { PrismaClient } from "@prisma/client";
export type { User } from "@prisma/client";
export { checkDatabase } from "./health";
export { createPrismaClient, disconnectPrismaClient, getPrismaClient } from "./client";
