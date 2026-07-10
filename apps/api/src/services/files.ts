import type {
  CursorPaginationQuery,
  FileCreateRequest,
  FileMoveRequest,
  FileUpdateRequest,
} from "@nimbus/contracts";
import {
  buildFileSearchDocument,
  type File as PrismaFile,
  getPrismaClient,
  Prisma,
  type PrismaClient,
} from "@nimbus/db";

import { HttpError } from "../middleware/error-handler";
import type { InternalUser } from "./users";
import { appendAuditLog, type AuditContext } from "./audit-log";
import { decodeCursor, toPage, type Page } from "./pagination";
import { normalizeResourceName } from "./resource-names";
import type { PermissionService } from "./permission-service";
import type { M8JobScheduler } from "./m8-jobs";

type TransactionClient = Prisma.TransactionClient;

export interface FileDto {
  id: string;
  ownerId: string;
  folderId: string;
  name: string;
  extension: string | null;
  mimeType: string | null;
  status: string;
  sizeBytes: string;
  contentHash: string | null;
  currentVersionId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileService {
  createFile(
    actor: InternalUser,
    input: FileCreateRequest,
    auditContext: AuditContext,
  ): Promise<FileDto>;
  getFile(actor: InternalUser, fileId: string): Promise<FileDto>;
  listFiles(
    actor: InternalUser,
    folderId: string,
    pagination: CursorPaginationQuery,
  ): Promise<Page<FileDto>>;
  updateFile(
    actor: InternalUser,
    fileId: string,
    input: FileUpdateRequest,
    auditContext: AuditContext,
  ): Promise<FileDto>;
  moveFile(
    actor: InternalUser,
    fileId: string,
    input: FileMoveRequest,
    auditContext: AuditContext,
  ): Promise<FileDto>;
  deleteFile(actor: InternalUser, fileId: string, auditContext: AuditContext): Promise<FileDto>;
  restoreFile(actor: InternalUser, fileId: string, auditContext: AuditContext): Promise<FileDto>;
}

export class PrismaFileService implements FileService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly prisma: PrismaClient = getPrismaClient(),
    private readonly m8Jobs?: M8JobScheduler,
  ) {}

  async createFile(
    actor: InternalUser,
    input: FileCreateRequest,
    auditContext: AuditContext,
  ): Promise<FileDto> {
    const name = normalizeResourceName(input.name);
    const folderId = input.folderId ?? actor.rootFolderId;
    const sizeBytes = parseSizeBytes(input.sizeBytes);

    const result = await this.prisma.$transaction(async (tx) => {
      await getActiveFolder(tx, actor.id, folderId);
      await assertFileNameAvailable(tx, actor.id, folderId, name.normalizedName);

      const file = await tx.file.create({
        data: {
          ownerId: actor.id,
          folderId,
          name: name.name,
          normalizedName: name.normalizedName,
          extension: name.extension,
          mimeType: input.mimeType ?? null,
          sizeBytes,
          status: "active",
          searchDocument: buildFileSearchDocument({
            name: name.name,
            extension: name.extension,
            mimeType: input.mimeType,
          }),
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.created",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          name: file.name,
          folderId: file.folderId,
          sizeBytes: file.sizeBytes.toString(),
          metadataOnly: true,
        },
      });

      return mapFile(file);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async getFile(actor: InternalUser, fileId: string): Promise<FileDto> {
    const grant = await this.permissionService.require(actor, "file.read", {
      resourceType: "file",
      resourceId: fileId,
    });

    return mapFile(grant.file);
  }

  async listFiles(
    actor: InternalUser,
    folderId: string,
    pagination: CursorPaginationQuery,
  ): Promise<Page<FileDto>> {
    await getActiveFolder(this.prisma, actor.id, folderId);

    const cursor = decodeCursor(pagination.cursor);
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    const cursorId = cursor?.id;
    const files = await this.prisma.file.findMany({
      where: {
        ownerId: actor.id,
        folderId,
        status: "active",
        deletedAt: null,
        ...(cursorDate
          ? {
              OR: [
                {
                  createdAt: {
                    gt: cursorDate,
                  },
                },
                {
                  createdAt: cursorDate,
                  id: {
                    gt: cursorId,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: pagination.limit + 1,
    });

    return toPage(files.map(mapFile), pagination.limit);
  }

  async updateFile(
    actor: InternalUser,
    fileId: string,
    input: FileUpdateRequest,
    auditContext: AuditContext,
  ): Promise<FileDto> {
    const grant = await this.permissionService.require(actor, "file.write", {
      resourceType: "file",
      resourceId: fileId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const file = await getActiveFile(tx, grant.file.ownerId, fileId);
      const name = input.name ? normalizeResourceName(input.name) : null;

      if (name) {
        await assertFileNameAvailable(
          tx,
          file.ownerId,
          file.folderId,
          name.normalizedName,
          file.id,
        );
      }

      const updatedFile = await tx.file.update({
        where: {
          id: file.id,
        },
        data: {
          ...(name
            ? {
                name: name.name,
                normalizedName: name.normalizedName,
                extension: name.extension,
              }
            : {}),
          ...(input.mimeType !== undefined
            ? {
                mimeType: input.mimeType,
              }
            : {}),
          searchDocument: buildFileSearchDocument({
            name: name?.name ?? file.name,
            extension: name?.extension ?? file.extension,
            mimeType: input.mimeType === undefined ? file.mimeType : input.mimeType,
          }),
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: name ? "file.renamed" : "file.updated",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          previousName: file.name,
          name: updatedFile.name,
          previousMimeType: file.mimeType,
          mimeType: updatedFile.mimeType,
        },
      });

      return mapFile(updatedFile);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async moveFile(
    actor: InternalUser,
    fileId: string,
    input: FileMoveRequest,
    auditContext: AuditContext,
  ): Promise<FileDto> {
    const grant = await this.permissionService.require(actor, "file.write", {
      resourceType: "file",
      resourceId: fileId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const file = await getActiveFile(tx, grant.file.ownerId, fileId);

      await getActiveFolder(tx, file.ownerId, input.folderId);
      await assertFileNameAvailable(tx, file.ownerId, input.folderId, file.normalizedName, file.id);

      const updatedFile = await tx.file.update({
        where: {
          id: file.id,
        },
        data: {
          folderId: input.folderId,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.moved",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          previousFolderId: file.folderId,
          folderId: updatedFile.folderId,
        },
      });

      return mapFile(updatedFile);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async deleteFile(
    actor: InternalUser,
    fileId: string,
    auditContext: AuditContext,
  ): Promise<FileDto> {
    const grant = await this.permissionService.require(actor, "file.delete", {
      resourceType: "file",
      resourceId: fileId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const file = await getActiveFile(tx, grant.file.ownerId, fileId);
      const deletedFile = await tx.file.update({
        where: {
          id: file.id,
        },
        data: {
          status: "deleted",
          deletedAt: new Date(),
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.deleted",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          folderId: file.folderId,
          name: file.name,
        },
      });

      return mapFile(deletedFile);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async restoreFile(
    actor: InternalUser,
    fileId: string,
    auditContext: AuditContext,
  ): Promise<FileDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const file = await tx.file.findFirst({
        where: {
          id: fileId,
          ownerId: actor.id,
          deletedAt: {
            not: null,
          },
        },
      });

      if (!file) {
        throw new HttpError(404, "file_not_found", "Deleted file was not found.");
      }

      await getActiveFolder(tx, actor.id, file.folderId);
      await assertFileNameAvailable(tx, actor.id, file.folderId, file.normalizedName, file.id);

      const restoredFile = await tx.file.update({
        where: {
          id: file.id,
        },
        data: {
          status: "active",
          deletedAt: null,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.restored",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          folderId: file.folderId,
          name: file.name,
        },
      });

      return mapFile(restoredFile);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  private async scheduleMetadata(file: FileDto, auditContext: AuditContext): Promise<void> {
    await this.m8Jobs?.scheduleMetadata({
      ownerId: file.ownerId,
      resourceType: "file",
      resourceId: file.id,
      correlationId: auditContext.correlationId ?? auditContext.requestId,
    });
  }
}

export function mapFile(file: PrismaFile): FileDto {
  return {
    id: file.id,
    ownerId: file.ownerId,
    folderId: file.folderId,
    name: file.name,
    extension: file.extension,
    mimeType: file.mimeType,
    status: file.status,
    sizeBytes: file.sizeBytes.toString(),
    contentHash: file.contentHash,
    currentVersionId: file.currentVersionId,
    deletedAt: file.deletedAt?.toISOString() ?? null,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

async function getActiveFile(
  prisma: PrismaClient | TransactionClient,
  ownerId: string,
  fileId: string,
): Promise<PrismaFile> {
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      ownerId,
      status: "active",
      deletedAt: null,
    },
  });

  if (!file) {
    throw new HttpError(404, "file_not_found", "File was not found.");
  }

  return file;
}

async function getActiveFolder(
  prisma: PrismaClient | TransactionClient,
  ownerId: string,
  folderId: string,
) {
  const folder = await prisma.folder.findFirst({
    where: {
      id: folderId,
      ownerId,
      deletedAt: null,
    },
  });

  if (!folder) {
    throw new HttpError(404, "folder_not_found", "Folder was not found.");
  }

  return folder;
}

async function assertFileNameAvailable(
  tx: TransactionClient,
  ownerId: string,
  folderId: string,
  normalizedName: string,
  excludeFileId?: string,
) {
  const existingFile = await tx.file.findFirst({
    where: {
      ownerId,
      folderId,
      normalizedName,
      status: {
        in: ["active", "uploading"],
      },
      deletedAt: null,
      ...(excludeFileId
        ? {
            id: {
              not: excludeFileId,
            },
          }
        : {}),
    },
  });

  if (existingFile) {
    throw new HttpError(409, "duplicate_file_name", "File name already exists in this folder.");
  }
}

function parseSizeBytes(value: FileCreateRequest["sizeBytes"]): bigint {
  if (value === undefined) {
    return 0n;
  }

  const sizeBytes = BigInt(value);

  if (sizeBytes < 0n) {
    throw new HttpError(400, "invalid_size_bytes", "sizeBytes must be non-negative.");
  }

  return sizeBytes;
}
