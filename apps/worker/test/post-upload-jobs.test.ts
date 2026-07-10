import {
  METADATA_INDEXING_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
  THUMBNAIL_GENERATION_QUEUE_NAME,
} from "@nimbus/contracts";
import { getPrismaClient } from "@nimbus/db";
import type { Queue } from "bullmq";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  type PostUploadQueues,
  schedulePendingCleanupJobs,
  schedulePostUploadJobs,
} from "../src/jobs/post-upload-jobs";

const prisma = getPrismaClient();
const runId = `m8-post-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`;

function createQueues(options: { failCleanupOnce?: boolean; failThumbnailOnce?: boolean } = {}) {
  let shouldFailCleanup = options.failCleanupOnce ?? false;
  let shouldFailThumbnail = options.failThumbnailOnce ?? false;
  const add = {
    metadata: vi.fn(async (_name, _payload, jobOptions) => ({ id: jobOptions.jobId })),
    thumbnail: vi.fn(async (_name, _payload, jobOptions) => {
      if (shouldFailThumbnail) {
        shouldFailThumbnail = false;
        throw new Error("redis unavailable");
      }
      return { id: jobOptions.jobId };
    }),
    cleanup: vi.fn(async (_name, _payload, jobOptions) => {
      if (shouldFailCleanup) {
        shouldFailCleanup = false;
        throw new Error("redis unavailable");
      }
      return { id: jobOptions.jobId };
    }),
  };
  const queues = {
    metadata: { add: add.metadata } as unknown as Queue,
    thumbnail: { add: add.thumbnail } as unknown as Queue,
    cleanup: { add: add.cleanup } as unknown as Queue,
  } as PostUploadQueues;
  return { queues, add };
}

async function createSession(slug: string, status: string) {
  const owner = await prisma.user.create({
    data: { authSubject: `${runId}-${slug}`, email: `${slug}@${runId}.nimbus.test` },
  });
  const folder = await prisma.folder.create({
    data: { ownerId: owner.id, name: "Root", normalizedName: "root", depth: 0 },
  });
  const file = await prisma.file.create({
    data: {
      ownerId: owner.id,
      folderId: folder.id,
      name: `${slug}.bin`,
      normalizedName: `${slug}.bin`,
      status: "uploading",
    },
  });
  const session = await prisma.uploadSession.create({
    data: {
      id: randomUUID(),
      ownerId: owner.id,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId: randomUUID(),
      filename: file.name,
      mimeType: "application/octet-stream",
      totalSizeBytes: 1n,
      finalObjectKey: `objects/${owner.id}/${file.id}/${randomUUID()}`,
      bucket: "nimbus-test",
      uploadType: "single_part",
      uploadMode: "new_file",
      status,
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  return { owner, folder, file, session };
}

async function addAvailableImageVersion(fixture: Awaited<ReturnType<typeof createSession>>) {
  const version = await prisma.fileVersion.create({
    data: {
      id: fixture.session.plannedVersionId,
      fileId: fixture.file.id,
      versionNumber: 1,
      storageProvider: "s3-compatible",
      bucket: fixture.session.bucket,
      objectKey: fixture.session.finalObjectKey,
      sizeBytes: 1n,
      mimeType: "image/png",
      uploadSessionId: fixture.session.id,
      createdById: fixture.owner.id,
      processingStatus: "available",
    },
  });
  await prisma.file.update({
    where: { id: fixture.file.id },
    data: {
      currentVersionId: version.id,
      status: "active",
      mimeType: "image/png",
    },
  });
  return version;
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${runId}.nimbus.test` } },
    select: { id: true },
  });
  const ownerIds = users.map(({ id }) => id);
  if (!ownerIds.length) return;
  await prisma.thumbnail.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.backgroundJob.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.fileVersion.deleteMany({ where: { createdById: { in: ownerIds } } });
  await prisma.uploadSession.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.file.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.folder.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
}

beforeAll(cleanup);
afterAll(cleanup);

describe.sequential("post-upload durable job scheduling", () => {
  it("deduplicates concurrent cleanup scheduling in PostgreSQL", async () => {
    const fixture = await createSession("concurrent", "canceled");
    const { queues, add } = createQueues();

    await Promise.all([
      schedulePostUploadJobs(fixture.session.id, queues, prisma),
      schedulePostUploadJobs(fixture.session.id, queues, prisma),
    ]);

    const jobs = await prisma.backgroundJob.findMany({
      where: { dedupeKey: `${fixture.session.id}:cleanup` },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      queueName: OBJECT_CLEANUP_QUEUE_NAME,
      status: "queued",
      bullmqJobId: jobs[0]?.id,
    });
    expect(new Set(add.cleanup.mock.calls.map((call) => call[2].jobId))).toEqual(
      new Set([jobs[0]?.id]),
    );
  });

  it("retries a failed enqueue against the same durable job", async () => {
    const fixture = await createSession("retry", "failed");
    const { queues, add } = createQueues({ failCleanupOnce: true });

    await schedulePostUploadJobs(fixture.session.id, queues, prisma);
    const failed = await prisma.backgroundJob.findUniqueOrThrow({
      where: { dedupeKey: `${fixture.session.id}:cleanup` },
    });
    expect(failed).toMatchObject({
      status: "failed",
      failureCode: "queue_enqueue_failed",
      bullmqJobId: null,
    });

    await schedulePendingCleanupJobs(queues, prisma, { ownerId: fixture.owner.id });
    const retried = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: failed.id } });
    expect(retried).toMatchObject({
      status: "queued",
      failureCode: null,
      bullmqJobId: failed.id,
    });
    expect(add.cleanup.mock.calls.filter((call) => call[2].jobId === failed.id)).toHaveLength(2);
  });

  it("expires only still-live sessions and fails only their upload placeholder", async () => {
    const expired = await createSession("expires", "uploading");
    const completed = await createSession("completed-race", "completed");
    const { queues } = createQueues();

    await schedulePendingCleanupJobs(queues, prisma, { ownerId: expired.owner.id });

    await expect(
      prisma.uploadSession.findUniqueOrThrow({ where: { id: expired.session.id } }),
    ).resolves.toMatchObject({ status: "expired", failureReason: "upload_session_expired" });
    await expect(
      prisma.file.findUniqueOrThrow({ where: { id: expired.file.id } }),
    ).resolves.toMatchObject({ status: "failed" });
    await expect(
      prisma.uploadSession.findUniqueOrThrow({ where: { id: completed.session.id } }),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      prisma.file.findUniqueOrThrow({ where: { id: completed.file.id } }),
    ).resolves.toMatchObject({ status: "uploading" });
  });

  it("retries failed post-upload thumbnail enqueueing for completed images", async () => {
    const fixture = await createSession("thumbnail-retry", "completed");
    const version = await addAvailableImageVersion(fixture);
    const { queues, add } = createQueues({ failThumbnailOnce: true });

    await schedulePostUploadJobs(fixture.session.id, queues, prisma);
    const failed = await prisma.backgroundJob.findUniqueOrThrow({
      where: { dedupeKey: `${fixture.session.id}:thumbnail` },
    });
    expect(failed).toMatchObject({
      resourceId: version.id,
      status: "failed",
      failureCode: "queue_enqueue_failed",
    });

    await schedulePendingCleanupJobs(queues, prisma, { ownerId: fixture.owner.id });
    await expect(
      prisma.backgroundJob.findUniqueOrThrow({ where: { id: failed.id } }),
    ).resolves.toMatchObject({
      status: "queued",
      failureCode: null,
      bullmqJobId: failed.id,
    });
    expect(add.thumbnail.mock.calls.filter((call) => call[2].jobId === failed.id)).toHaveLength(2);
  });

  it("uses only registered M8 queue names", () => {
    expect([
      METADATA_INDEXING_QUEUE_NAME,
      THUMBNAIL_GENERATION_QUEUE_NAME,
      OBJECT_CLEANUP_QUEUE_NAME,
    ]).toEqual(["metadata-indexing", "thumbnail-generation", "object-cleanup"]);
  });
});
