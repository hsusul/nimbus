import type { CursorPaginationQuery } from "@nimbus/contracts";
import {
  type File as PrismaFile,
  type FileVersion as PrismaFileVersion,
  getPrismaClient,
  Prisma,
  type PrismaClient,
} from "@nimbus/db";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import { mapFile, type FileDto } from "./files";
import { decodeCursor, encodeCursor, type Page } from "./pagination";
import type { InternalUser } from "./users";

type TransactionClient = Prisma.TransactionClient;

export interface FileVersionDto {
  versionId: string;
  fileId: string;
  versionNumber: number;
  sizeBytes: string;
  mimeType: string;
  contentHash: string | null;
  createdAt: string;
  createdById: string;
  processingStatus: string;
  isCurrent: boolean;
}

export interface RestoreFileVersionResult {
  file: FileDto;
  currentVersion: FileVersionDto;
}

export interface VersionService {
  listVersions(
    actor: InternalUser,
    fileId: string,
    pagination: CursorPaginationQuery,
  ): Promise<Page<FileVersionDto>>;
  restoreVersion(
    actor: InternalUser,
    fileId: string,
    versionId: string,
    auditContext: AuditContext,
  ): Promise<RestoreFileVersionResult>;
}

export class PrismaVersionService implements VersionService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async listVersions(
    actor: InternalUser,
    fileId: string,
    pagination: CursorPaginationQuery,
  ): Promise<Page<FileVersionDto>> {
    const file = await getActiveOwnedFile(this.prisma, actor.id, fileId);
    const cursor = decodeCursor(pagination.cursor);
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    const cursorId = cursor?.id;
    const versions = await this.prisma.fileVersion.findMany({
      where: {
        fileId: file.id,
        ...(cursorDate
          ? {
              OR: [
                {
                  createdAt: {
                    lt: cursorDate,
                  },
                },
                {
                  createdAt: cursorDate,
                  id: {
                    lt: cursorId,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pagination.limit + 1,
    });

    return toVersionPage(versions, pagination.limit, file.currentVersionId);
  }

  async restoreVersion(
    actor: InternalUser,
    fileId: string,
    versionId: string,
    auditContext: AuditContext,
  ): Promise<RestoreFileVersionResult> {
    return this.prisma.$transaction(async (tx) => {
      const file = await getActiveOwnedFile(tx, actor.id, fileId);
      const version = await tx.fileVersion.findFirst({
        where: {
          id: versionId,
          fileId: file.id,
        },
      });

      if (!version) {
        throw new HttpError(404, "file_version_not_found", "File version was not found.");
      }

      if (version.processingStatus !== "available") {
        throw new HttpError(
          409,
          "file_version_not_available",
          "File version is not available for restore.",
        );
      }

      const restoredFile = await tx.file.update({
        where: {
          id: file.id,
        },
        data: {
          currentVersionId: version.id,
          sizeBytes: version.sizeBytes,
          mimeType: version.mimeType,
          contentHash: version.sha256,
        },
      });

      await appendAuditLog(tx, {
        ...auditContext,
        action: "file.version_restored",
        resourceType: "file",
        resourceId: file.id,
        metadata: {
          previousVersionId: file.currentVersionId,
          restoredVersionId: version.id,
          versionNumber: version.versionNumber,
          sizeBytes: version.sizeBytes.toString(),
        },
      });

      return {
        file: mapFile(restoredFile),
        currentVersion: mapFileVersion(version, restoredFile.currentVersionId),
      };
    });
  }
}

function toVersionPage(
  versions: PrismaFileVersion[],
  limit: number,
  currentVersionId: string | null,
): Page<FileVersionDto> {
  const pageItems = versions.slice(0, limit);
  const lastItem = pageItems.at(-1);
  const hasMore = versions.length > limit;

  return {
    items: pageItems.map((version) => mapFileVersion(version, currentVersionId)),
    pageInfo: {
      hasMore,
      nextCursor:
        hasMore && lastItem
          ? encodeCursor({
              createdAt: lastItem.createdAt.toISOString(),
              id: lastItem.id,
            })
          : null,
    },
  };
}

function mapFileVersion(
  version: PrismaFileVersion,
  currentVersionId: string | null,
): FileVersionDto {
  return {
    versionId: version.id,
    fileId: version.fileId,
    versionNumber: version.versionNumber,
    sizeBytes: version.sizeBytes.toString(),
    mimeType: version.mimeType,
    contentHash: version.sha256,
    createdAt: version.createdAt.toISOString(),
    createdById: version.createdById,
    processingStatus: version.processingStatus,
    isCurrent: version.id === currentVersionId,
  };
}

async function getActiveOwnedFile(
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
