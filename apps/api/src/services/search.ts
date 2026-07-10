import type { SearchQuery, SearchResult } from "@nimbus/contracts";
import { getPrismaClient, Prisma, type PrismaClient } from "@nimbus/db";

import { HttpError } from "../middleware/error-handler";
import type { Page } from "./pagination";
import type { InternalUser } from "./users";

interface SearchCursor {
  exactRank: number;
  textRank: number;
  updatedAt: string;
  resourceType: "file" | "folder";
  resourceId: string;
}

interface SearchRow {
  resource_type: "file" | "folder";
  resource_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: bigint | null;
  container_id: string | null;
  created_at: Date;
  updated_at: Date;
  owner_id: string;
  share_role: string | null;
  exact_rank: number;
  text_rank: number;
}

export interface SearchService {
  search(actor: InternalUser, query: SearchQuery): Promise<Page<SearchResult>>;
}

export class PrismaSearchService implements SearchService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async search(actor: InternalUser, query: SearchQuery): Promise<Page<SearchResult>> {
    const cursor = decodeSearchCursor(query.cursor);
    const normalizedQuery = query.q.trim().toLowerCase();
    const includeFiles = query.type !== "folder";
    const includeFolders = query.type !== "file" && !query.mimeType;
    const candidates: Prisma.Sql[] = [];

    if (includeFiles) {
      candidates.push(buildFileCandidates(actor.id, normalizedQuery, query.mimeType));
    }

    if (includeFolders) {
      candidates.push(buildFolderCandidates(actor.id, normalizedQuery));
    }

    if (candidates.length === 0) {
      return { items: [], pageInfo: { hasMore: false, nextCursor: null } };
    }

    const cursorFilter = cursor ? buildCursorFilter(cursor) : Prisma.empty;
    const rows = await this.prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      WITH candidates AS (
        ${Prisma.join(candidates, " UNION ALL ")}
      )
      SELECT *
      FROM candidates
      ${cursor ? Prisma.sql`WHERE ${cursorFilter}` : Prisma.empty}
      ORDER BY exact_rank ASC,
               text_rank DESC,
               updated_at DESC,
               resource_type ASC,
               resource_id ASC
      LIMIT ${query.limit + 1}
    `);
    const pageRows = rows.slice(0, query.limit);
    const last = pageRows.at(-1);
    const hasMore = rows.length > query.limit;

    return {
      items: pageRows.map((row) => mapSearchRow(row, actor.id)),
      pageInfo: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeSearchCursor({
                exactRank: last.exact_rank,
                textRank: last.text_rank,
                updatedAt: last.updated_at.toISOString(),
                resourceType: last.resource_type,
                resourceId: last.resource_id,
              })
            : null,
      },
    };
  }
}

function buildFileCandidates(actorId: string, query: string, mimeType?: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      'file'::text AS resource_type,
      file.id AS resource_id,
      file.name,
      file.mime_type,
      file.size_bytes,
      file.folder_id AS container_id,
      file.created_at,
      file.updated_at,
      file.owner_id,
      direct_share.role AS share_role,
      CASE
        WHEN file.normalized_name = ${query} THEN 0
        WHEN file.normalized_name LIKE ${`${query}%`} THEN 1
        ELSE 2
      END::int AS exact_rank,
      round(ts_rank(file.search_vector, websearch_to_tsquery('simple', ${query})) * 1000000)::int AS text_rank
    FROM files AS file
    INNER JOIN users AS owner_user ON owner_user.id = file.owner_id AND owner_user.status = 'active'
    LEFT JOIN LATERAL (
      SELECT share.role
      FROM shares AS share
      WHERE share.resource_type = 'file'
        AND share.resource_id = file.id
        AND share.grantee_user_id = ${actorId}
        AND share.role IN ('viewer', 'editor')
        AND share.revoked_at IS NULL
        AND (share.expires_at IS NULL OR share.expires_at > NOW())
      ORDER BY share.created_at DESC, share.id DESC
      LIMIT 1
    ) AS direct_share ON TRUE
    WHERE file.status = 'active'
      AND file.deleted_at IS NULL
      AND (file.owner_id = ${actorId} OR direct_share.role IS NOT NULL)
      ${mimeType ? Prisma.sql`AND file.mime_type = ${mimeType}` : Prisma.empty}
      AND (
        file.search_vector @@ websearch_to_tsquery('simple', ${query})
        OR file.normalized_name LIKE ${`${query}%`}
      )
  `;
}

function buildFolderCandidates(actorId: string, query: string): Prisma.Sql {
  return Prisma.sql`
    SELECT
      'folder'::text AS resource_type,
      folder.id AS resource_id,
      folder.name,
      NULL::text AS mime_type,
      NULL::bigint AS size_bytes,
      folder.parent_folder_id AS container_id,
      folder.created_at,
      folder.updated_at,
      folder.owner_id,
      NULL::text AS share_role,
      CASE
        WHEN folder.normalized_name = ${query} THEN 0
        WHEN folder.normalized_name LIKE ${`${query}%`} THEN 1
        ELSE 2
      END::int AS exact_rank,
      round(ts_rank(folder.search_vector, websearch_to_tsquery('simple', ${query})) * 1000000)::int AS text_rank
    FROM folders AS folder
    WHERE folder.owner_id = ${actorId}
      AND folder.status = 'active'
      AND folder.deleted_at IS NULL
      AND (
        folder.search_vector @@ websearch_to_tsquery('simple', ${query})
        OR folder.normalized_name LIKE ${`${query}%`}
      )
  `;
}

function buildCursorFilter(cursor: SearchCursor): Prisma.Sql {
  const updatedAt = new Date(cursor.updatedAt);

  return Prisma.sql`
    exact_rank > ${cursor.exactRank}
    OR (exact_rank = ${cursor.exactRank} AND text_rank < ${cursor.textRank})
    OR (exact_rank = ${cursor.exactRank} AND text_rank = ${cursor.textRank} AND updated_at < ${updatedAt})
    OR (exact_rank = ${cursor.exactRank} AND text_rank = ${cursor.textRank} AND updated_at = ${updatedAt} AND resource_type > ${cursor.resourceType})
    OR (exact_rank = ${cursor.exactRank} AND text_rank = ${cursor.textRank} AND updated_at = ${updatedAt} AND resource_type = ${cursor.resourceType} AND resource_id > ${cursor.resourceId})
  `;
}

function mapSearchRow(row: SearchRow, actorId: string): SearchResult {
  if (row.resource_type === "folder") {
    return {
      resourceType: "folder",
      resourceId: row.resource_id,
      name: row.name,
      parentFolderId: row.container_id,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      access: { classification: "owner", role: "owner" },
    };
  }

  const owner = row.owner_id === actorId;
  return {
    resourceType: "file",
    resourceId: row.resource_id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: (row.size_bytes ?? 0n).toString(),
    folderId: row.container_id ?? "",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    access: {
      classification: owner ? "owner" : "shared",
      role: owner ? "owner" : row.share_role === "editor" ? "editor" : "viewer",
    },
  };
}

function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeSearchCursor(value: string | undefined): SearchCursor | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SearchCursor;
    if (
      !Number.isInteger(parsed.exactRank) ||
      !Number.isInteger(parsed.textRank) ||
      !parsed.updatedAt ||
      Number.isNaN(Date.parse(parsed.updatedAt)) ||
      !["file", "folder"].includes(parsed.resourceType) ||
      !parsed.resourceId
    ) {
      throw new Error("invalid_search_cursor");
    }
    return parsed;
  } catch {
    throw new HttpError(400, "invalid_cursor", "Pagination cursor is invalid.");
  }
}
