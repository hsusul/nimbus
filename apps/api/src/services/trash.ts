import type { CursorPaginationQuery, TrashItem } from "@nimbus/contracts";
import { getPrismaClient, Prisma, type PrismaClient } from "@nimbus/db";

import type { Page } from "./pagination";
import { decodeCursor, encodeCursor } from "./pagination";
import type { InternalUser } from "./users";

interface TrashRow {
  resource_type: "file" | "folder";
  resource_id: string;
  name: string;
  container_id: string | null;
  mime_type: string | null;
  size_bytes: bigint | null;
  deleted_at: Date;
  updated_at: Date;
}

export interface TrashService {
  listTrash(actor: InternalUser, query: CursorPaginationQuery): Promise<Page<TrashItem>>;
}

export class PrismaTrashService implements TrashService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async listTrash(actor: InternalUser, query: CursorPaginationQuery): Promise<Page<TrashItem>> {
    const cursor = decodeCursor(query.cursor);
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    const rows = await this.prisma.$queryRaw<TrashRow[]>(Prisma.sql`
      WITH deleted_resources AS (
        SELECT
          'file'::text AS resource_type,
          file.id AS resource_id,
          file.name,
          file.folder_id AS container_id,
          file.mime_type,
          file.size_bytes,
          file.deleted_at,
          file.updated_at
        FROM files AS file
        WHERE file.owner_id = ${actor.id}
          AND file.deleted_at IS NOT NULL
        UNION ALL
        SELECT
          'folder'::text AS resource_type,
          folder.id AS resource_id,
          folder.name,
          folder.parent_folder_id AS container_id,
          NULL::text AS mime_type,
          NULL::bigint AS size_bytes,
          folder.deleted_at,
          folder.updated_at
        FROM folders AS folder
        WHERE folder.owner_id = ${actor.id}
          AND folder.deleted_at IS NOT NULL
      )
      SELECT *
      FROM deleted_resources
      ${
        cursorDate
          ? Prisma.sql`
              WHERE deleted_at < ${cursorDate}
                 OR (deleted_at = ${cursorDate} AND resource_id < ${cursor?.id})
            `
          : Prisma.empty
      }
      ORDER BY deleted_at DESC, resource_id DESC
      LIMIT ${query.limit + 1}
    `);
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    const hasMore = rows.length > query.limit;

    return {
      items: pageRows.map(mapTrashRow),
      pageInfo: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.deleted_at.toISOString(), id: last.resource_id })
            : null,
      },
    };
  }
}

function mapTrashRow(row: TrashRow): TrashItem {
  const common = {
    resourceId: row.resource_id,
    name: row.name,
    deletedAt: row.deleted_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };

  if (row.resource_type === "folder") {
    return {
      ...common,
      resourceType: "folder",
      parentFolderId: row.container_id,
    };
  }

  return {
    ...common,
    resourceType: "file",
    folderId: row.container_id ?? "",
    mimeType: row.mime_type,
    sizeBytes: (row.size_bytes ?? 0n).toString(),
  };
}
