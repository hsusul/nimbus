import { PrismaSearchService } from "../apps/api/src/services/search";
import type { InternalUser } from "../apps/api/src/services/users";
import {
  buildFileSearchDocument,
  disconnectPrismaClient,
  getPrismaClient,
  Prisma,
} from "../packages/db/src/index";

const prisma = getPrismaClient();
const runId = `search-explain-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fixtureRows = 100_000;

interface ExplainNode {
  [key: string]: unknown;
  Plans?: ExplainNode[];
  "Index Name"?: string;
  "Node Type"?: string;
}

interface ExplainResult {
  Plan: ExplainNode;
  "Planning Time": number;
  "Execution Time": number;
}

try {
  const [viewer, publisher, unrelated] = await Promise.all(
    ["viewer", "publisher", "unrelated"].map((slug) =>
      prisma.user.create({
        data: {
          authSubject: `${runId}-${slug}`,
          email: `${slug}@${runId}.nimbus.test`,
        },
      }),
    ),
  );
  const [viewerRoot, publisherRoot, unrelatedRoot] = await Promise.all([
    createRoot(viewer.id),
    createRoot(publisher.id),
    createRoot(unrelated.id),
  ]);

  for (let offset = 0; offset < fixtureRows; offset += 1000) {
    await prisma.file.createMany({
      data: Array.from({ length: Math.min(1000, fixtureRows - offset) }, (_, index) => {
        const number = offset + index;
        const name = `archive-${number}.txt`;
        return {
          ownerId: number % 2 === 0 ? publisher.id : unrelated.id,
          folderId: number % 2 === 0 ? publisherRoot.id : unrelatedRoot.id,
          name,
          normalizedName: name,
          extension: "txt",
          mimeType: "text/plain",
          status: "active",
          sizeBytes: 1n,
          searchDocument: buildFileSearchDocument({
            name,
            extension: "txt",
            mimeType: "text/plain",
          }),
        };
      }),
    });
  }

  const matches = await Promise.all(
    Array.from({ length: 28 }, (_, index) => {
      const owned = index < 4;
      const name = `needle-report-${index}.pdf`;
      const deleted = index >= 20 && index < 22;
      const uploading = index >= 22 && index < 24;
      return prisma.file.create({
        data: {
          ownerId: owned ? viewer.id : publisher.id,
          folderId: owned ? viewerRoot.id : publisherRoot.id,
          name,
          normalizedName: name,
          extension: "pdf",
          mimeType: "application/pdf",
          status: deleted ? "deleted" : uploading ? "uploading" : "active",
          deletedAt: deleted ? new Date() : null,
          sizeBytes: 100n,
          searchDocument: buildFileSearchDocument({
            name,
            extension: "pdf",
            mimeType: "application/pdf",
          }),
        },
      });
    }),
  );

  await prisma.share.createMany({
    data: matches.slice(4, 20).map((file, offset) => ({
      resourceType: "file",
      resourceId: file.id,
      granteeUserId: viewer.id,
      role: offset % 2 === 0 ? "viewer" : "editor",
      createdById: publisher.id,
      revokedAt: offset >= 8 && offset < 10 ? new Date() : null,
      expiresAt: offset >= 10 && offset < 12 ? new Date(Date.now() - 60_000) : null,
    })),
  });
  await prisma.$executeRawUnsafe("ANALYZE files, shares");

  const actor: InternalUser = {
    id: viewer.id,
    email: viewer.email,
    displayName: "Search Explain Viewer",
    status: viewer.status,
    storageQuotaBytes: viewer.storageQuotaBytes,
    storageUsedBytes: viewer.storageUsedBytes,
    rootFolderId: viewerRoot.id,
  };
  const serviceStartedAt = performance.now();
  const search = await new PrismaSearchService(prisma).search(actor, {
    q: "needle",
    type: "file",
    limit: 100,
  });
  const serviceDurationMs = performance.now() - serviceStartedAt;

  const explainRows = await prisma.$queryRaw<Array<{ "QUERY PLAN": ExplainResult[] }>>(Prisma.sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT
      file.id,
      CASE
        WHEN file.normalized_name = 'needle' THEN 0
        WHEN file.normalized_name LIKE 'needle%' THEN 1
        ELSE 2
      END AS exact_rank,
      round(ts_rank(file.search_vector, websearch_to_tsquery('simple', 'needle')) * 1000000)::int AS text_rank,
      file.updated_at
    FROM files AS file
    INNER JOIN users AS owner_user
      ON owner_user.id = file.owner_id AND owner_user.status = 'active'
    LEFT JOIN LATERAL (
      SELECT share.role
      FROM shares AS share
      WHERE share.resource_type = 'file'
        AND share.resource_id = file.id
        AND share.grantee_user_id = ${viewer.id}
        AND share.role IN ('viewer', 'editor')
        AND share.revoked_at IS NULL
        AND (share.expires_at IS NULL OR share.expires_at > NOW())
      ORDER BY share.created_at DESC, share.id DESC
      LIMIT 1
    ) AS direct_share ON TRUE
    WHERE file.status = 'active'
      AND file.deleted_at IS NULL
      AND (file.owner_id = ${viewer.id} OR direct_share.role IS NOT NULL)
      AND (
        file.search_vector @@ websearch_to_tsquery('simple', 'needle')
        OR file.normalized_name LIKE 'needle%'
      )
    ORDER BY exact_rank ASC, text_rank DESC, file.updated_at DESC, file.id ASC
    LIMIT 101
  `);
  const explain = explainRows[0]?.["QUERY PLAN"]?.[0];
  if (!explain) throw new Error("search_explain_result_missing");
  const mainIndexNames = [...collect(explain.Plan, "Index Name")].sort();
  const mainNodeTypes = [...collect(explain.Plan, "Node Type")].sort();
  const searchExplainRows = await prisma.$queryRaw<Array<{ "QUERY PLAN": ExplainResult[] }>>(
    Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
      SELECT file.id
      FROM files AS file
      WHERE file.status = 'active'
        AND file.deleted_at IS NULL
        AND file.search_vector @@ websearch_to_tsquery('simple', 'needle')
    `,
  );
  const searchExplain = searchExplainRows[0]?.["QUERY PLAN"]?.[0];
  if (!searchExplain) throw new Error("search_predicate_explain_result_missing");
  const searchIndexNames = [...collect(searchExplain.Plan, "Index Name")].sort();
  const searchNodeTypes = [...collect(searchExplain.Plan, "Node Type")].sort();
  if (!searchIndexNames.includes("files_search_vector_idx")) {
    throw new Error(`search_gin_index_not_used indexes=${searchIndexNames.join(",")}`);
  }
  if (search.items.length !== 16) {
    throw new Error(`search_authorized_result_count_mismatch actual=${search.items.length}`);
  }

  console.log(
    JSON.stringify({
      status: "ok",
      fixture: {
        totalFiles: fixtureRows + matches.length,
        ownedMatches: 4,
        activeSharedMatches: 12,
        revokedMatches: 2,
        expiredMatches: 2,
        deletedMatches: 2,
        uploadingMatches: 2,
        unrelatedActiveMatches: 4,
      },
      returnedResults: search.items.length,
      mainQueryIndexes: mainIndexNames,
      mainQueryPlanNodes: mainNodeTypes,
      searchPredicateIndexes: searchIndexNames,
      searchPredicatePlanNodes: searchNodeTypes,
      planningTimeMs: explain["Planning Time"],
      executionTimeMs: explain["Execution Time"],
      searchPredicateExecutionTimeMs: searchExplain["Execution Time"],
      serviceDurationMs: Number(serviceDurationMs.toFixed(2)),
      measurement: "single local functional run, not a load test",
    }),
  );
} finally {
  await cleanupRows();
  await disconnectPrismaClient();
}

async function createRoot(ownerId: string) {
  return prisma.folder.create({
    data: {
      ownerId,
      name: "Root",
      normalizedName: "root",
      depth: 0,
      searchDocument: "Root",
    },
  });
}

function collect(node: ExplainNode, key: "Index Name" | "Node Type", output = new Set<string>()) {
  const value = node[key];
  if (typeof value === "string") output.add(value);
  for (const child of node.Plans ?? []) collect(child, key, output);
  return output;
}

async function cleanupRows() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${runId}.nimbus.test` } },
    select: { id: true },
  });
  const ownerIds = users.map(({ id }) => id);
  if (!ownerIds.length) return;
  await prisma.share.deleteMany({
    where: { OR: [{ createdById: { in: ownerIds } }, { granteeUserId: { in: ownerIds } }] },
  });
  await prisma.file.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.folder.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
}
