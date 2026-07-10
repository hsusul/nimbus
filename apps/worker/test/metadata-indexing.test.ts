import { METADATA_INDEXING_QUEUE_NAME } from "@nimbus/contracts";
import { buildFileSearchDocument, buildFolderSearchDocument, getPrismaClient } from "@nimbus/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { indexResourceMetadata } from "../src/jobs/metadata-indexing";

const prisma = getPrismaClient();
const runId = `m8-index-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function createFixture(slug: string) {
  const user = await prisma.user.create({
    data: { authSubject: `${runId}-${slug}`, email: `${slug}@${runId}.nimbus.test` },
  });
  const folder = await prisma.folder.create({
    data: {
      ownerId: user.id,
      name: "Current Folder",
      normalizedName: "current folder",
      depth: 0,
      searchDocument: "stale folder payload",
    },
  });
  const file = await prisma.file.create({
    data: {
      ownerId: user.id,
      folderId: folder.id,
      name: "Current File.png",
      normalizedName: "current file.png",
      extension: "png",
      mimeType: "image/png",
      status: "active",
      searchDocument: "stale file payload",
    },
  });
  return { user, folder, file };
}

async function createJob(ownerId: string, resourceType: "file" | "folder", resourceId: string) {
  return prisma.backgroundJob.create({
    data: {
      ownerId,
      queueName: METADATA_INDEXING_QUEUE_NAME,
      resourceType,
      resourceId,
      status: "queued",
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
  await prisma.file.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.folder.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(cleanup);
afterAll(cleanup);

describe.sequential("metadata indexing worker", () => {
  it("re-reads current file and folder metadata and is idempotent", async () => {
    const fixture = await createFixture("current");
    const fileJob = await createJob(fixture.user.id, "file", fixture.file.id);
    const folderJob = await createJob(fixture.user.id, "folder", fixture.folder.id);

    await indexResourceMetadata({
      resourceType: "file",
      resourceId: fixture.file.id,
      backgroundJobId: fileJob.id,
      correlationId: "stale-payload-has-no-name",
    });
    await indexResourceMetadata({
      resourceType: "folder",
      resourceId: fixture.folder.id,
      backgroundJobId: folderJob.id,
    });
    await indexResourceMetadata({
      resourceType: "file",
      resourceId: fixture.file.id,
      backgroundJobId: fileJob.id,
    });

    const [file, folder, jobs] = await Promise.all([
      prisma.file.findUniqueOrThrow({ where: { id: fixture.file.id } }),
      prisma.folder.findUniqueOrThrow({ where: { id: fixture.folder.id } }),
      prisma.backgroundJob.findMany({ where: { id: { in: [fileJob.id, folderJob.id] } } }),
    ]);
    expect(file.searchDocument).toBe(buildFileSearchDocument(file));
    expect(folder.searchDocument).toBe(buildFolderSearchDocument(folder.name));
    expect(file.searchIndexedAt).not.toBeNull();
    expect(folder.searchIndexedAt).not.toBeNull();
    expect(jobs.every((job) => job.status === "succeeded")).toBe(true);
  });

  it("reconciles rename state and safely indexes deleted/restored rows", async () => {
    const fixture = await createFixture("lifecycle");
    await prisma.file.update({
      where: { id: fixture.file.id },
      data: {
        name: "Renamed Current.png",
        normalizedName: "renamed current.png",
        status: "deleted",
        deletedAt: new Date(),
      },
    });
    const deletedJob = await createJob(fixture.user.id, "file", fixture.file.id);
    await indexResourceMetadata({
      resourceType: "file",
      resourceId: fixture.file.id,
      backgroundJobId: deletedJob.id,
    });
    const deleted = await prisma.file.findUniqueOrThrow({ where: { id: fixture.file.id } });
    expect(deleted.searchDocument).toContain("Renamed Current.png");
    expect(deleted.status).toBe("deleted");

    await prisma.file.update({
      where: { id: fixture.file.id },
      data: { status: "active", deletedAt: null },
    });
    const restoredJob = await createJob(fixture.user.id, "file", fixture.file.id);
    await indexResourceMetadata({
      resourceType: "file",
      resourceId: fixture.file.id,
      backgroundJobId: restoredJob.id,
    });
    await expect(
      prisma.backgroundJob.findUniqueOrThrow({ where: { id: restoredJob.id } }),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("records a sanitized failed durable job and rethrows transient database errors", async () => {
    const fixture = await createFixture("transient");
    const job = await createJob(fixture.user.id, "file", fixture.file.id);
    const update = vi
      .spyOn(prisma.file, "update")
      .mockRejectedValueOnce(new Error("private database detail"));

    await expect(
      indexResourceMetadata({
        resourceType: "file",
        resourceId: fixture.file.id,
        backgroundJobId: job.id,
      }),
    ).rejects.toThrow("private database detail");
    update.mockRestore();

    const failed = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed).toMatchObject({
      status: "failed",
      failureCode: "metadata_indexing_failed",
      lastError: "metadata_indexing_failed",
    });
  });
});
