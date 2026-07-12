export { Prisma, PrismaClient } from "@prisma/client";
export type {
  AuditLog,
  BackgroundJob,
  File,
  FileVersion,
  Folder,
  Share,
  ShareLink,
  Thumbnail,
  UploadChunk,
  UploadSession,
  User,
  ApiKey,
} from "@prisma/client";
export { checkDatabase } from "./health";
export { createPrismaClient, disconnectPrismaClient, getPrismaClient } from "./client";
export { buildFileSearchDocument, buildFolderSearchDocument } from "./search-document";
