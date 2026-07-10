import {
  METADATA_INDEXING_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
  type MetadataIndexingJobPayload,
  type ObjectCleanupJobPayload,
  type ThumbnailGenerationJobPayload,
} from "@nimbus/contracts";
import { getPrismaClient } from "@nimbus/db";
import { afterAll, describe, expect, it, vi } from "vitest";

import { type M8QueueAdapter, PrismaM8JobScheduler } from "../src/services/m8-jobs";

const prisma = getPrismaClient();
const runId = `m8-scheduler-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ownerIds: string[] = [];

async function createOwner(slug: string) {
  const owner = await prisma.user.create({
    data: { authSubject: `${runId}-${slug}`, email: `${slug}@${runId}.nimbus.test` },
  });
  ownerIds.push(owner.id);
  return owner;
}

afterAll(async () => {
  await prisma.backgroundJob.deleteMany({ where: { ownerId: { in: ownerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
});

describe.sequential("M8 API durable job scheduler", () => {
  it("persists the job before enqueueing an IDs-only payload", async () => {
    const owner = await createOwner("success");
    const enqueueMetadata = vi.fn(async (payload: MetadataIndexingJobPayload) => {
      const durable = await prisma.backgroundJob.findUnique({
        where: { id: payload.backgroundJobId },
      });
      expect(durable).toMatchObject({ status: "queued", bullmqJobId: null });
      return { bullmqJobId: payload.backgroundJobId };
    });
    const queue: M8QueueAdapter = {
      enqueueMetadata,
      enqueueThumbnail: async (_payload: ThumbnailGenerationJobPayload) => ({
        bullmqJobId: "unused",
      }),
      enqueueCleanup: async (_payload: ObjectCleanupJobPayload) => ({
        bullmqJobId: "unused",
      }),
    };
    const scheduler = new PrismaM8JobScheduler(queue, prisma);

    const id = await scheduler.scheduleMetadata({
      ownerId: owner.id,
      resourceType: "file",
      resourceId: "file-safe-id",
      correlationId: "correlation-safe-id",
    });

    expect(enqueueMetadata).toHaveBeenCalledWith({
      resourceType: "file",
      resourceId: "file-safe-id",
      backgroundJobId: id,
      correlationId: "correlation-safe-id",
    });
    await expect(prisma.backgroundJob.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({
      queueName: METADATA_INDEXING_QUEUE_NAME,
      bullmqJobId: id,
      status: "queued",
      lastError: null,
      failureCode: null,
    });
  });

  it("records a sanitized durable failure when enqueueing fails", async () => {
    const owner = await createOwner("failure");
    const queue: M8QueueAdapter = {
      enqueueMetadata: async (_payload: MetadataIndexingJobPayload) => ({
        bullmqJobId: "unused",
      }),
      enqueueThumbnail: async (_payload: ThumbnailGenerationJobPayload) => ({
        bullmqJobId: "unused",
      }),
      enqueueCleanup: async (_payload: ObjectCleanupJobPayload) => {
        throw new Error("redis://user:secret@internal:6379 private provider response");
      },
    };
    const scheduler = new PrismaM8JobScheduler(queue, prisma);

    const id = await scheduler.scheduleCleanup({
      ownerId: owner.id,
      uploadSessionId: "session-safe-id",
    });

    const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id } });
    expect(job).toMatchObject({
      queueName: OBJECT_CLEANUP_QUEUE_NAME,
      status: "failed",
      failureCode: "queue_enqueue_failed",
      lastError: "queue_enqueue_failed",
      bullmqJobId: null,
    });
    expect(JSON.stringify(job)).not.toContain("secret");
    expect(JSON.stringify(job)).not.toContain("provider response");
  });
});
