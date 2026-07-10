import type { ApiConfig } from "@nimbus/config";
import { getPrismaClient } from "@nimbus/db";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

const testConfig: ApiConfig = {
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
    bucket: "nimbus-local",
    region: "us-east-1",
    signedUploadUrlTtlSeconds: 900,
    signedDownloadUrlTtlSeconds: 300,
  },
};

const runId = `m2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function authHeaders(userSlug: string) {
  return {
    "x-nimbus-dev-user": `${runId}-${userSlug}`,
    "x-nimbus-dev-email": `${userSlug}@${runId}.nimbus.test`,
  };
}

async function ensureRootFolder(userSlug: string): Promise<string> {
  const response = await request(app).get("/api/v1/me").set(authHeaders(userSlug)).expect(200);

  return response.body.data.rootFolderId as string;
}

async function cleanupRunData() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        endsWith: `@${runId}.nimbus.test`,
      },
    },
    select: {
      id: true,
    },
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length === 0) {
    return;
  }

  await prisma.auditLog.deleteMany({
    where: {
      actorUserId: {
        in: userIds,
      },
    },
  });
  await prisma.file.deleteMany({
    where: {
      ownerId: {
        in: userIds,
      },
    },
  });

  for (let depth = 32; depth >= 0; depth -= 1) {
    await prisma.folder.deleteMany({
      where: {
        ownerId: {
          in: userIds,
        },
        depth,
      },
    });
  }

  await prisma.user.deleteMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
}

beforeAll(async () => {
  await cleanupRunData();
});

afterAll(async () => {
  await cleanupRunData();
});

describe.sequential("metadata core routes", () => {
  it("creates a root folder during user provisioning", async () => {
    const rootFolderId = await ensureRootFolder("root");
    const rootFolder = await prisma.folder.findUniqueOrThrow({
      where: {
        id: rootFolderId,
      },
    });

    expect(rootFolder.parentFolderId).toBeNull();
    expect(rootFolder.depth).toBe(0);
    expect(rootFolder.name).toBe("Root");
  });

  it("creates, paginates, renames, moves, soft deletes, restores, and audits folders", async () => {
    const headers = authHeaders("folders");
    const rootFolderId = await ensureRootFolder("folders");

    const alpha = await request(app)
      .post("/api/v1/folders")
      .set(headers)
      .send({ name: "Alpha", parentFolderId: rootFolderId })
      .expect(201);
    const sibling = await request(app)
      .post("/api/v1/folders")
      .set(headers)
      .send({ name: "Sibling", parentFolderId: rootFolderId })
      .expect(201);
    const beta = await request(app)
      .post("/api/v1/folders")
      .set(headers)
      .send({ name: "Beta", parentFolderId: alpha.body.data.id })
      .expect(201);
    const gamma = await request(app)
      .post("/api/v1/folders")
      .set(headers)
      .send({ name: "Gamma", parentFolderId: beta.body.data.id })
      .expect(201);

    const firstPage = await request(app)
      .get(`/api/v1/folders/${rootFolderId}/children`)
      .query({ limit: 1 })
      .set(headers)
      .expect(200);

    expect(firstPage.body.data.children).toHaveLength(1);
    expect(firstPage.body.data.pageInfo.hasMore).toBe(true);
    expect(firstPage.body.data.pageInfo.nextCursor).toEqual(expect.any(String));

    const secondPage = await request(app)
      .get(`/api/v1/folders/${rootFolderId}/children`)
      .query({ limit: 10, cursor: firstPage.body.data.pageInfo.nextCursor })
      .set(headers)
      .expect(200);

    expect(secondPage.body.data.children.map((child: { id: string }) => child.id)).toContain(
      sibling.body.data.id,
    );

    const renamedAlpha = await request(app)
      .patch(`/api/v1/folders/${alpha.body.data.id}`)
      .set(headers)
      .send({ name: "Alpha Renamed" })
      .expect(200);

    expect(renamedAlpha.body.data.name).toBe("Alpha Renamed");

    await request(app)
      .post(`/api/v1/folders/${alpha.body.data.id}/move`)
      .set(headers)
      .send({ parentFolderId: gamma.body.data.id })
      .expect(409);

    const movedBeta = await request(app)
      .post(`/api/v1/folders/${beta.body.data.id}/move`)
      .set(headers)
      .send({ parentFolderId: rootFolderId })
      .expect(200);

    expect(movedBeta.body.data.parentFolderId).toBe(rootFolderId);

    await request(app).delete(`/api/v1/folders/${alpha.body.data.id}`).set(headers).expect(200);

    const hiddenAfterDelete = await request(app)
      .get(`/api/v1/folders/${rootFolderId}/children`)
      .query({ limit: 20 })
      .set(headers)
      .expect(200);

    expect(
      hiddenAfterDelete.body.data.children.map((child: { id: string }) => child.id),
    ).not.toContain(alpha.body.data.id);

    await request(app)
      .post(`/api/v1/folders/${alpha.body.data.id}/restore`)
      .set(headers)
      .expect(200);

    const visibleAfterRestore = await request(app)
      .get(`/api/v1/folders/${rootFolderId}/children`)
      .query({ limit: 20 })
      .set(headers)
      .expect(200);

    expect(
      visibleAfterRestore.body.data.children.map((child: { id: string }) => child.id),
    ).toContain(alpha.body.data.id);

    const auditResponse = await request(app)
      .get("/api/v1/audit-logs")
      .query({ limit: 50 })
      .set(headers)
      .expect(200);
    const actions = auditResponse.body.data.auditLogs.map((log: { action: string }) => log.action);

    expect(actions).toEqual(expect.arrayContaining(["folder.created", "folder.moved"]));
    expect(actions).toEqual(expect.arrayContaining(["folder.deleted", "folder.restored"]));
  });

  it("creates, renames, moves, soft deletes, restores, lists, and audits file metadata", async () => {
    const headers = authHeaders("files");
    const rootFolderId = await ensureRootFolder("files");
    const sourceFolder = await request(app)
      .post("/api/v1/folders")
      .set(headers)
      .send({ name: "Source", parentFolderId: rootFolderId })
      .expect(201);
    const targetFolder = await request(app)
      .post("/api/v1/folders")
      .set(headers)
      .send({ name: "Target", parentFolderId: rootFolderId })
      .expect(201);

    const createdFile = await request(app)
      .post("/api/v1/files")
      .set(headers)
      .send({
        name: "Report.txt",
        folderId: sourceFolder.body.data.id,
        mimeType: "text/plain",
        sizeBytes: "0",
      })
      .expect(201);

    expect(createdFile.body.data.extension).toBe("txt");

    const renamedFile = await request(app)
      .patch(`/api/v1/files/${createdFile.body.data.id}`)
      .set(headers)
      .send({ name: "Report Final.txt" })
      .expect(200);

    expect(renamedFile.body.data.name).toBe("Report Final.txt");

    const movedFile = await request(app)
      .post(`/api/v1/files/${createdFile.body.data.id}/move`)
      .set(headers)
      .send({ folderId: targetFolder.body.data.id })
      .expect(200);

    expect(movedFile.body.data.folderId).toBe(targetFolder.body.data.id);

    const sourceFiles = await request(app)
      .get("/api/v1/files")
      .query({ folderId: sourceFolder.body.data.id })
      .set(headers)
      .expect(200);

    expect(sourceFiles.body.data.files).toHaveLength(0);

    await request(app).delete(`/api/v1/files/${createdFile.body.data.id}`).set(headers).expect(200);

    const hiddenAfterDelete = await request(app)
      .get("/api/v1/files")
      .query({ folderId: targetFolder.body.data.id })
      .set(headers)
      .expect(200);

    expect(hiddenAfterDelete.body.data.files).toHaveLength(0);

    await request(app)
      .post(`/api/v1/files/${createdFile.body.data.id}/restore`)
      .set(headers)
      .expect(200);

    const visibleAfterRestore = await request(app)
      .get("/api/v1/files")
      .query({ folderId: targetFolder.body.data.id })
      .set(headers)
      .expect(200);

    expect(visibleAfterRestore.body.data.files.map((file: { id: string }) => file.id)).toContain(
      createdFile.body.data.id,
    );

    const auditResponse = await request(app)
      .get("/api/v1/audit-logs")
      .query({ limit: 50 })
      .set(headers)
      .expect(200);
    const actions = auditResponse.body.data.auditLogs.map((log: { action: string }) => log.action);

    expect(actions).toEqual(expect.arrayContaining(["file.created", "file.moved"]));
    expect(actions).toEqual(expect.arrayContaining(["file.deleted", "file.restored"]));
  });

  it("denies access to another user's folder and file metadata", async () => {
    const ownerHeaders = authHeaders("owner");
    const intruderHeaders = authHeaders("intruder");
    const ownerRootFolderId = await ensureRootFolder("owner");
    await ensureRootFolder("intruder");

    const ownerFolder = await request(app)
      .post("/api/v1/folders")
      .set(ownerHeaders)
      .send({ name: "Private Folder", parentFolderId: ownerRootFolderId })
      .expect(201);
    const ownerFile = await request(app)
      .post("/api/v1/files")
      .set(ownerHeaders)
      .send({ name: "Private.txt", folderId: ownerFolder.body.data.id })
      .expect(201);

    await request(app)
      .get(`/api/v1/folders/${ownerFolder.body.data.id}`)
      .set(intruderHeaders)
      .expect(404);
    await request(app)
      .get(`/api/v1/files/${ownerFile.body.data.id}`)
      .set(intruderHeaders)
      .expect(404);
  });

  it("lists only the authenticated owner's deleted files and folders", async () => {
    const ownerHeaders = authHeaders("trash-owner");
    const otherHeaders = authHeaders("trash-other");
    const ownerRoot = await ensureRootFolder("trash-owner");
    const otherRoot = await ensureRootFolder("trash-other");
    const ownerFolder = await request(app)
      .post("/api/v1/folders")
      .set(ownerHeaders)
      .send({ name: "Deleted Folder", parentFolderId: ownerRoot })
      .expect(201);
    const ownerFile = await request(app)
      .post("/api/v1/files")
      .set(ownerHeaders)
      .send({ name: "deleted.txt", folderId: ownerRoot, sizeBytes: "5" })
      .expect(201);
    const otherFile = await request(app)
      .post("/api/v1/files")
      .set(otherHeaders)
      .send({ name: "private.txt", folderId: otherRoot, sizeBytes: "7" })
      .expect(201);

    await request(app)
      .delete(`/api/v1/folders/${ownerFolder.body.data.id}`)
      .set(ownerHeaders)
      .expect(200);
    await request(app)
      .delete(`/api/v1/files/${ownerFile.body.data.id}`)
      .set(ownerHeaders)
      .expect(200);
    await request(app)
      .delete(`/api/v1/files/${otherFile.body.data.id}`)
      .set(otherHeaders)
      .expect(200);

    const first = await request(app)
      .get("/api/v1/trash")
      .query({ limit: 1 })
      .set(ownerHeaders)
      .expect(200);
    expect(first.body.data.items).toHaveLength(1);
    expect(first.body.data.pageInfo.hasMore).toBe(true);
    expect(JSON.stringify(first.body)).not.toContain(otherFile.body.data.id);
    expect(JSON.stringify(first.body)).not.toContain("objectKey");

    const second = await request(app)
      .get("/api/v1/trash")
      .query({ limit: 10, cursor: first.body.data.pageInfo.nextCursor })
      .set(ownerHeaders)
      .expect(200);
    const ids = [...first.body.data.items, ...second.body.data.items].map(
      (item: { resourceId: string }) => item.resourceId,
    );
    expect(ids).toEqual(expect.arrayContaining([ownerFolder.body.data.id, ownerFile.body.data.id]));
    expect(ids).not.toContain(otherFile.body.data.id);
  });
});
