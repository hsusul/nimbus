import { getApiConfig, type ApiConfig } from "@nimbus/config";
import { SearchResponseSchema } from "@nimbus/contracts";
import { buildFileSearchDocument, buildFolderSearchDocument, getPrismaClient } from "@nimbus/db";
import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

const testConfig: ApiConfig = {
  ...getApiConfig({ NODE_ENV: "test", DEPLOYMENT_PROFILE: "test" }),
  nodeEnv: "test",
  logLevel: "error",
  host: "127.0.0.1",
  port: 0,
  corsOrigin: "http://localhost:3000",
  authMode: "dev",
  devAuthEnabled: true,
  maxFolderDepth: 32,
  maxFileSizeBytes: 5368709120,
  signedUploadUrlTtlSeconds: 900,
  signedDownloadUrlTtlSeconds: 300,
  uploadSessionTtlSeconds: 86400,
  multipartUploadThresholdBytes: 67108864,
  multipartChunkSizeBytes: 8388608,
  databaseUrl: "postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public",
  redisUrl: "redis://localhost:6379",
  storage: {
    endpoint: "http://localhost:9000",
    accessKey: "nimbus",
    secretKey: "nimbus-secret",
    bucket: "nimbus-test",
    region: "us-east-1",
    forcePathStyle: true,
    signedUploadUrlTtlSeconds: 900,
    signedDownloadUrlTtlSeconds: 300,
  },
};

const runId = `m8-api-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const prisma = getPrismaClient();
const m8JobScheduler = {
  scheduleMetadata: async () => "m8-metadata-test-job",
  scheduleThumbnail: async () => "m8-thumbnail-test-job",
  scheduleCleanup: async () => "m8-cleanup-test-job",
};
const app = createApp({
  config: testConfig,
  readinessChecker: async () => ({ postgres: true, redis: true }),
  m8JobScheduler,
});

function headers(slug: string) {
  return {
    "x-nimbus-dev-user": `${runId}-${slug}`,
    "x-nimbus-dev-email": `${slug}@${runId}.nimbus.test`,
  };
}

async function ensureUser(slug: string) {
  const response = await request(app).get("/api/v1/me").set(headers(slug)).expect(200);
  return {
    id: response.body.data.id as string,
    email: response.body.data.email as string,
    rootFolderId: response.body.data.rootFolderId as string,
  };
}

async function createFolder(
  ownerId: string,
  parentFolderId: string,
  name: string,
  status = "active",
) {
  return prisma.folder.create({
    data: {
      ownerId,
      parentFolderId,
      name,
      normalizedName: name.toLowerCase(),
      depth: 1,
      status,
      deletedAt: status === "deleted" ? new Date() : null,
      searchDocument: buildFolderSearchDocument(name),
    },
  });
}

async function createFile(
  ownerId: string,
  folderId: string,
  name: string,
  options: { status?: string; mimeType?: string; deleted?: boolean } = {},
) {
  const extension = name.includes(".") ? (name.split(".").at(-1) ?? null) : null;
  const mimeType = options.mimeType ?? "text/plain";
  return prisma.file.create({
    data: {
      ownerId,
      folderId,
      name,
      normalizedName: name.toLowerCase(),
      extension,
      mimeType,
      sizeBytes: 12n,
      status: options.status ?? "active",
      deletedAt: options.deleted ? new Date() : null,
      searchDocument: buildFileSearchDocument({ name, extension, mimeType }),
    },
  });
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${runId}.nimbus.test` } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (!ids.length) return;
  await prisma.backgroundJob.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.shareLink.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.share.deleteMany({
    where: { OR: [{ createdById: { in: ids } }, { granteeUserId: { in: ids } }] },
  });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.file.deleteMany({ where: { ownerId: { in: ids } } });
  for (let depth = 32; depth >= 0; depth -= 1) {
    await prisma.folder.deleteMany({ where: { ownerId: { in: ids }, depth } });
  }
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(cleanup);
afterAll(cleanup);

describe.sequential("M8 PostgreSQL metadata search", () => {
  it("enforces owner, direct-share, status, owner-account, and public-link boundaries", async () => {
    const owner = await ensureUser("search-owner");
    const viewer = await ensureUser("search-viewer");
    const editor = await ensureUser("search-editor");
    const unrelated = await ensureUser("search-unrelated");
    const disabledOwner = await ensureUser("search-disabled-owner");
    const folder = await createFolder(owner.id, owner.rootFolderId, "Report Folder");
    const deletedFolder = await createFolder(
      owner.id,
      owner.rootFolderId,
      "Report Deleted",
      "deleted",
    );
    const ownedFile = await createFile(owner.id, folder.id, "Report.pdf", {
      mimeType: "application/pdf",
    });
    const viewerFile = await createFile(owner.id, folder.id, "Report Viewer.txt");
    const editorFile = await createFile(owner.id, folder.id, "Report Editor.txt");
    const revokedFile = await createFile(owner.id, folder.id, "Report Revoked.txt");
    const expiredFile = await createFile(owner.id, folder.id, "Report Expired.txt");
    const failedFile = await createFile(owner.id, folder.id, "Report Failed.txt", {
      status: "failed",
    });
    const uploadingFile = await createFile(owner.id, folder.id, "Report Uploading.txt", {
      status: "uploading",
    });
    const deletedFile = await createFile(owner.id, folder.id, "Report Deleted.txt", {
      status: "deleted",
      deleted: true,
    });
    const publicOnlyFile = await createFile(owner.id, folder.id, "Report Public.txt");
    const unrelatedFile = await createFile(
      unrelated.id,
      unrelated.rootFolderId,
      "Report Private.txt",
    );
    const disabledFile = await createFile(
      disabledOwner.id,
      disabledOwner.rootFolderId,
      "Report Disabled.txt",
    );

    await prisma.share.createMany({
      data: [
        {
          resourceType: "file",
          resourceId: viewerFile.id,
          granteeUserId: viewer.id,
          role: "viewer",
          createdById: owner.id,
        },
        {
          resourceType: "file",
          resourceId: editorFile.id,
          granteeUserId: editor.id,
          role: "editor",
          createdById: owner.id,
        },
        {
          resourceType: "file",
          resourceId: revokedFile.id,
          granteeUserId: viewer.id,
          role: "viewer",
          createdById: owner.id,
          revokedAt: new Date(),
        },
        {
          resourceType: "file",
          resourceId: expiredFile.id,
          granteeUserId: viewer.id,
          role: "viewer",
          createdById: owner.id,
          expiresAt: new Date(Date.now() - 1000),
        },
        {
          resourceType: "file",
          resourceId: disabledFile.id,
          granteeUserId: viewer.id,
          role: "viewer",
          createdById: disabledOwner.id,
        },
      ],
    });
    await prisma.shareLink.create({
      data: {
        resourceType: "file",
        resourceId: publicOnlyFile.id,
        tokenHash: createHash("sha256").update(randomUUID()).digest("hex"),
        createdById: owner.id,
      },
    });
    await prisma.user.update({ where: { id: disabledOwner.id }, data: { status: "disabled" } });

    const ownerSearch = await request(app)
      .get("/api/v1/search")
      .query({ q: "report", limit: 100 })
      .set(headers("search-owner"))
      .expect(200);
    const ownerIds = ownerSearch.body.data.results.map(
      (result: { resourceId: string }) => result.resourceId,
    );
    expect(ownerIds).toEqual(
      expect.arrayContaining([folder.id, ownedFile.id, viewerFile.id, publicOnlyFile.id]),
    );
    expect(ownerIds).not.toEqual(
      expect.arrayContaining([
        deletedFolder.id,
        failedFile.id,
        uploadingFile.id,
        deletedFile.id,
        unrelatedFile.id,
      ]),
    );

    const viewerSearch = await request(app)
      .get("/api/v1/search")
      .query({ q: "report", limit: 100 })
      .set(headers("search-viewer"))
      .expect(200);
    const viewerIds = viewerSearch.body.data.results.map(
      (result: { resourceId: string }) => result.resourceId,
    );
    expect(viewerIds).toContain(viewerFile.id);
    expect(viewerIds).not.toEqual(
      expect.arrayContaining([
        revokedFile.id,
        expiredFile.id,
        publicOnlyFile.id,
        disabledFile.id,
        ownedFile.id,
      ]),
    );
    expect(viewerSearch.body.data.results[0]?.access.role).toBe("viewer");

    const editorSearch = await request(app)
      .get("/api/v1/search")
      .query({ q: "report" })
      .set(headers("search-editor"))
      .expect(200);
    expect(editorSearch.body.data.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: editorFile.id,
          access: { classification: "shared", role: "editor" },
        }),
      ]),
    );
    expect(SearchResponseSchema.parse(ownerSearch.body)).toBeTruthy();
  });

  it("supports MIME/type filters, query bounds, and duplicate-free stable pagination", async () => {
    const owner = await ensureUser("pagination-owner");
    const folder = await createFolder(owner.id, owner.rootFolderId, "Report Pagination Folder");
    for (let index = 0; index < 5; index += 1) {
      await createFile(owner.id, folder.id, `Report Pagination ${index}.txt`);
    }
    await createFile(owner.id, folder.id, "Report Pagination.pdf", {
      mimeType: "application/pdf",
    });

    const fileOnly = await request(app)
      .get("/api/v1/search")
      .query({ q: "report", type: "file", mimeType: "application/pdf" })
      .set(headers("pagination-owner"))
      .expect(200);
    expect(fileOnly.body.data.results).toHaveLength(1);
    expect(fileOnly.body.data.results[0]).toMatchObject({
      resourceType: "file",
      mimeType: "application/pdf",
    });

    const folderOnly = await request(app)
      .get("/api/v1/search")
      .query({ q: "report", type: "folder" })
      .set(headers("pagination-owner"))
      .expect(200);
    expect(
      folderOnly.body.data.results.every(
        (result: { resourceType: string }) => result.resourceType === "folder",
      ),
    ).toBe(true);

    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await request(app)
        .get("/api/v1/search")
        .query({ q: "report", type: "file", limit: 2, ...(cursor ? { cursor } : {}) })
        .set(headers("pagination-owner"))
        .expect(200);
      for (const result of page.body.data.results as Array<{ resourceId: string }>) {
        expect(seen.has(result.resourceId)).toBe(false);
        seen.add(result.resourceId);
      }
      cursor = page.body.data.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(6);

    await request(app)
      .get("/api/v1/search")
      .query({ q: "   " })
      .set(headers("pagination-owner"))
      .expect(400);
    await request(app)
      .get("/api/v1/search")
      .query({ q: "x".repeat(129) })
      .set(headers("pagination-owner"))
      .expect(400);
    await request(app)
      .get("/api/v1/search")
      .query({ q: "report", limit: 101 })
      .set(headers("pagination-owner"))
      .expect(400);
  });
});

describe.sequential("M8 background job visibility", () => {
  it("lists and reads only owner jobs with filters, pagination, and safe failures", async () => {
    const owner = await ensureUser("jobs-owner");
    const unrelated = await ensureUser("jobs-unrelated");
    const ownerJobs = await Promise.all(
      ["upload-finalization", "metadata-indexing", "thumbnail-generation"].map((queueName, index) =>
        prisma.backgroundJob.create({
          data: {
            ownerId: owner.id,
            queueName,
            resourceType: index === 0 ? "upload_session" : "file",
            resourceId: `resource-${index}`,
            status: index === 1 ? "failed" : "succeeded",
            attempts: 1,
            maxAttempts: 3,
            failureCode: index === 1 ? "metadata_indexing_failed" : null,
            lastError: index === 1 ? "private stack and object key" : null,
            completedAt: new Date(),
          },
        }),
      ),
    );
    const unrelatedJob = await prisma.backgroundJob.create({
      data: {
        ownerId: unrelated.id,
        queueName: "object-cleanup",
        resourceType: "upload_session",
        resourceId: "private-resource",
        status: "queued",
      },
    });

    const first = await request(app)
      .get("/api/v1/jobs")
      .query({ limit: 2 })
      .set(headers("jobs-owner"))
      .expect(200);
    expect(first.body.data.jobs).toHaveLength(2);
    expect(JSON.stringify(first.body)).not.toContain("private stack");
    expect(JSON.stringify(first.body)).not.toContain("lastError");
    const second = await request(app)
      .get("/api/v1/jobs")
      .query({ limit: 2, cursor: first.body.data.pageInfo.nextCursor })
      .set(headers("jobs-owner"))
      .expect(200);
    const listedIds = [...first.body.data.jobs, ...second.body.data.jobs].map(
      (job: { jobId: string }) => job.jobId,
    );
    expect(new Set(listedIds)).toHaveLength(3);

    const failed = await request(app)
      .get("/api/v1/jobs")
      .query({ type: "metadata-indexing", status: "failed" })
      .set(headers("jobs-owner"))
      .expect(200);
    expect(failed.body.data.jobs).toEqual([
      expect.objectContaining({ jobId: ownerJobs[1]?.id, failureCode: "metadata_indexing_failed" }),
    ]);
    await request(app)
      .get(`/api/v1/jobs/${ownerJobs[0]?.id}`)
      .set(headers("jobs-owner"))
      .expect(200);
    await request(app)
      .get(`/api/v1/jobs/${unrelatedJob.id}`)
      .set(headers("jobs-owner"))
      .expect(404);
  });
});
