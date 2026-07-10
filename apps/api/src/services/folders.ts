import type {
  CursorPaginationQuery,
  FolderCreateRequest,
  FolderMoveRequest,
  FolderUpdateRequest,
} from "@nimbus/contracts";
import {
  buildFolderSearchDocument,
  type File as PrismaFile,
  type Folder as PrismaFolder,
  getPrismaClient,
  Prisma,
  type PrismaClient,
} from "@nimbus/db";

import { HttpError } from "../middleware/error-handler";
import type { InternalUser } from "./users";
import { appendAuditLog, type AuditContext } from "./audit-log";
import { assertMoveDoesNotCreateCycle, type FolderAncestor } from "./folder-cycle";
import { decodeCursor, toPage, type Page } from "./pagination";
import { normalizeResourceName } from "./resource-names";
import type { M8JobScheduler } from "./m8-jobs";

type TransactionClient = Prisma.TransactionClient;

export interface FolderDto {
  id: string;
  ownerId: string;
  parentFolderId: string | null;
  name: string;
  depth: number;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FolderChildDto =
  | {
      type: "folder";
      id: string;
      name: string;
      parentFolderId: string;
      depth: number;
      createdAt: string;
      updatedAt: string;
    }
  | {
      type: "file";
      id: string;
      name: string;
      folderId: string;
      mimeType: string | null;
      sizeBytes: string;
      createdAt: string;
      updatedAt: string;
    };

export interface FolderChildrenPage extends Page<FolderChildDto> {
  folderId: string;
}

export interface FolderService {
  createFolder(
    actor: InternalUser,
    input: FolderCreateRequest,
    auditContext: AuditContext,
  ): Promise<FolderDto>;
  getFolder(actor: InternalUser, folderId: string): Promise<FolderDto>;
  listChildren(
    actor: InternalUser,
    folderId: string,
    pagination: CursorPaginationQuery,
  ): Promise<FolderChildrenPage>;
  updateFolder(
    actor: InternalUser,
    folderId: string,
    input: FolderUpdateRequest,
    auditContext: AuditContext,
  ): Promise<FolderDto>;
  moveFolder(
    actor: InternalUser,
    folderId: string,
    input: FolderMoveRequest,
    auditContext: AuditContext,
  ): Promise<FolderDto>;
  deleteFolder(
    actor: InternalUser,
    folderId: string,
    auditContext: AuditContext,
  ): Promise<FolderDto>;
  restoreFolder(
    actor: InternalUser,
    folderId: string,
    auditContext: AuditContext,
  ): Promise<FolderDto>;
}

export class PrismaFolderService implements FolderService {
  constructor(
    private readonly prisma: PrismaClient = getPrismaClient(),
    private readonly maxFolderDepth = 32,
    private readonly m8Jobs?: M8JobScheduler,
  ) {}

  async createFolder(
    actor: InternalUser,
    input: FolderCreateRequest,
    auditContext: AuditContext,
  ): Promise<FolderDto> {
    const name = normalizeResourceName(input.name);
    const parentFolderId = input.parentFolderId ?? actor.rootFolderId;

    const result = await this.prisma.$transaction(async (tx) => {
      const parentFolder = await getActiveFolder(tx, actor.id, parentFolderId);
      const depth = parentFolder.depth + 1;

      assertFolderDepth(depth, this.maxFolderDepth);
      await assertFolderNameAvailable(tx, actor.id, parentFolder.id, name.normalizedName);

      const folder = await tx.folder.create({
        data: {
          ownerId: actor.id,
          parentFolderId: parentFolder.id,
          name: name.name,
          normalizedName: name.normalizedName,
          depth,
          status: "active",
          searchDocument: buildFolderSearchDocument(name.name),
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "folder.created",
        resourceType: "folder",
        resourceId: folder.id,
        metadata: {
          name: folder.name,
          parentFolderId: folder.parentFolderId,
        },
      });

      return mapFolder(folder);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async getFolder(actor: InternalUser, folderId: string): Promise<FolderDto> {
    const folder = await this.prisma.folder.findFirst({
      where: {
        id: folderId,
        ownerId: actor.id,
        deletedAt: null,
      },
    });

    if (!folder) {
      throw new HttpError(404, "folder_not_found", "Folder was not found.");
    }

    return mapFolder(folder);
  }

  async listChildren(
    actor: InternalUser,
    folderId: string,
    pagination: CursorPaginationQuery,
  ): Promise<FolderChildrenPage> {
    await getActiveFolder(this.prisma, actor.id, folderId);

    const cursor = decodeCursor(pagination.cursor);
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    const cursorId = cursor?.id;
    const cursorWhere = cursorDate
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
      : {};

    const [folders, files] = await Promise.all([
      this.prisma.folder.findMany({
        where: {
          ownerId: actor.id,
          parentFolderId: folderId,
          deletedAt: null,
          ...cursorWhere,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pagination.limit + 1,
      }),
      this.prisma.file.findMany({
        where: {
          ownerId: actor.id,
          folderId,
          status: "active",
          deletedAt: null,
          ...cursorWhere,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: pagination.limit + 1,
      }),
    ]);

    const merged = [...folders.map(mapFolderChild), ...files.map(mapFileChild)].sort(
      compareChildren,
    );
    const page = toPage(merged, pagination.limit);

    return {
      folderId,
      ...page,
    };
  }

  async updateFolder(
    actor: InternalUser,
    folderId: string,
    input: FolderUpdateRequest,
    auditContext: AuditContext,
  ): Promise<FolderDto> {
    if (input.name === undefined) {
      throw new HttpError(400, "validation_failed", "Folder name is required.");
    }

    const name = normalizeResourceName(input.name);

    const result = await this.prisma.$transaction(async (tx) => {
      const folder = await getActiveFolder(tx, actor.id, folderId);

      if (!folder.parentFolderId) {
        throw new HttpError(409, "root_folder_immutable", "Root folder cannot be renamed.");
      }

      await assertFolderNameAvailable(
        tx,
        actor.id,
        folder.parentFolderId,
        name.normalizedName,
        folder.id,
      );

      const updatedFolder = await tx.folder.update({
        where: {
          id: folder.id,
        },
        data: {
          name: name.name,
          normalizedName: name.normalizedName,
          searchDocument: buildFolderSearchDocument(name.name),
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "folder.renamed",
        resourceType: "folder",
        resourceId: folder.id,
        metadata: {
          previousName: folder.name,
          name: updatedFolder.name,
        },
      });

      return mapFolder(updatedFolder);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async moveFolder(
    actor: InternalUser,
    folderId: string,
    input: FolderMoveRequest,
    auditContext: AuditContext,
  ): Promise<FolderDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const folder = await getActiveFolder(tx, actor.id, folderId);
      const targetParent = await getActiveFolder(tx, actor.id, input.parentFolderId);

      if (!folder.parentFolderId) {
        throw new HttpError(409, "root_folder_immutable", "Root folder cannot be moved.");
      }

      const targetAncestors = await loadFolderAncestors(tx, actor.id, targetParent.id);
      assertMoveDoesNotCreateCycle(folder.id, targetAncestors);

      const nextDepth = targetParent.depth + 1;
      assertFolderDepth(nextDepth, this.maxFolderDepth);
      await assertFolderNameAvailable(
        tx,
        actor.id,
        targetParent.id,
        folder.normalizedName,
        folder.id,
      );

      const updatedFolder = await tx.folder.update({
        where: {
          id: folder.id,
        },
        data: {
          parentFolderId: targetParent.id,
          depth: nextDepth,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "folder.moved",
        resourceType: "folder",
        resourceId: folder.id,
        metadata: {
          previousParentFolderId: folder.parentFolderId,
          parentFolderId: targetParent.id,
        },
      });

      return mapFolder(updatedFolder);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async deleteFolder(
    actor: InternalUser,
    folderId: string,
    auditContext: AuditContext,
  ): Promise<FolderDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const folder = await getActiveFolder(tx, actor.id, folderId);

      if (!folder.parentFolderId) {
        throw new HttpError(409, "root_folder_immutable", "Root folder cannot be deleted.");
      }

      const deletedFolder = await tx.folder.update({
        where: {
          id: folder.id,
        },
        data: {
          status: "deleted",
          deletedAt: new Date(),
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "folder.deleted",
        resourceType: "folder",
        resourceId: folder.id,
        metadata: {
          parentFolderId: folder.parentFolderId,
          name: folder.name,
        },
      });

      return mapFolder(deletedFolder);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  async restoreFolder(
    actor: InternalUser,
    folderId: string,
    auditContext: AuditContext,
  ): Promise<FolderDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const folder = await tx.folder.findFirst({
        where: {
          id: folderId,
          ownerId: actor.id,
          deletedAt: {
            not: null,
          },
        },
      });

      if (!folder) {
        throw new HttpError(404, "folder_not_found", "Deleted folder was not found.");
      }

      if (!folder.parentFolderId) {
        throw new HttpError(409, "root_folder_immutable", "Root folder cannot be restored.");
      }

      await getActiveFolder(tx, actor.id, folder.parentFolderId);
      await assertFolderNameAvailable(
        tx,
        actor.id,
        folder.parentFolderId,
        folder.normalizedName,
        folder.id,
      );

      const restoredFolder = await tx.folder.update({
        where: {
          id: folder.id,
        },
        data: {
          status: "active",
          deletedAt: null,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "folder.restored",
        resourceType: "folder",
        resourceId: folder.id,
        metadata: {
          parentFolderId: folder.parentFolderId,
          name: folder.name,
        },
      });

      return mapFolder(restoredFolder);
    });
    await this.scheduleMetadata(result, auditContext);
    return result;
  }

  private async scheduleMetadata(folder: FolderDto, auditContext: AuditContext): Promise<void> {
    await this.m8Jobs?.scheduleMetadata({
      ownerId: folder.ownerId,
      resourceType: "folder",
      resourceId: folder.id,
      correlationId: auditContext.correlationId ?? auditContext.requestId,
    });
  }
}

export function mapFolder(folder: PrismaFolder): FolderDto {
  return {
    id: folder.id,
    ownerId: folder.ownerId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    depth: folder.depth,
    status: folder.status,
    deletedAt: folder.deletedAt?.toISOString() ?? null,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

async function getActiveFolder(
  prisma: PrismaClient | TransactionClient,
  ownerId: string,
  folderId: string,
): Promise<PrismaFolder> {
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

async function assertFolderNameAvailable(
  tx: TransactionClient,
  ownerId: string,
  parentFolderId: string,
  normalizedName: string,
  excludeFolderId?: string,
) {
  const existingFolder = await tx.folder.findFirst({
    where: {
      ownerId,
      parentFolderId,
      normalizedName,
      deletedAt: null,
      ...(excludeFolderId
        ? {
            id: {
              not: excludeFolderId,
            },
          }
        : {}),
    },
  });

  if (existingFolder) {
    throw new HttpError(409, "duplicate_folder_name", "Folder name already exists in this folder.");
  }
}

async function loadFolderAncestors(
  tx: TransactionClient,
  ownerId: string,
  startFolderId: string,
): Promise<FolderAncestor[]> {
  const ancestors: FolderAncestor[] = [];
  let currentFolderId: string | null = startFolderId;
  let guard = 0;

  while (currentFolderId) {
    guard += 1;

    if (guard > 256) {
      throw new HttpError(409, "folder_cycle", "Existing folder tree contains a cycle.");
    }

    const folder: FolderAncestor | null = await tx.folder.findFirst({
      where: {
        id: currentFolderId,
        ownerId,
        deletedAt: null,
      },
      select: {
        id: true,
        parentFolderId: true,
      },
    });

    if (!folder) {
      throw new HttpError(404, "folder_not_found", "Folder was not found.");
    }

    ancestors.push(folder);
    currentFolderId = folder.parentFolderId;
  }

  return ancestors;
}

function assertFolderDepth(depth: number, maxDepth: number) {
  if (depth > maxDepth) {
    throw new HttpError(409, "folder_depth_exceeded", "Folder depth limit would be exceeded.");
  }
}

function mapFolderChild(folder: PrismaFolder): FolderChildDto {
  if (!folder.parentFolderId) {
    throw new Error("Root folder cannot be returned as a child.");
  }

  return {
    type: "folder",
    id: folder.id,
    name: folder.name,
    parentFolderId: folder.parentFolderId,
    depth: folder.depth,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

function mapFileChild(file: PrismaFile): FolderChildDto {
  return {
    type: "file",
    id: file.id,
    name: file.name,
    folderId: file.folderId,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes.toString(),
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
  };
}

function compareChildren(left: FolderChildDto, right: FolderChildDto) {
  const createdAtComparison = left.createdAt.localeCompare(right.createdAt);

  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  return left.id.localeCompare(right.id);
}
