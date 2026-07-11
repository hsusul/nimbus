import {
  METADATA_INDEXING_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
  THUMBNAIL_GENERATION_QUEUE_NAME,
  type MetadataIndexingJobPayload,
  type ObjectCleanupJobPayload,
  type ThumbnailGenerationJobPayload,
} from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import { Queue, type ConnectionOptions } from "bullmq";

export interface M8QueueAdapter {
  enqueueMetadata(input: MetadataIndexingJobPayload): Promise<{ bullmqJobId: string }>;
  enqueueThumbnail(input: ThumbnailGenerationJobPayload): Promise<{ bullmqJobId: string }>;
  enqueueCleanup(input: ObjectCleanupJobPayload): Promise<{ bullmqJobId: string }>;
  close?(): Promise<void>;
}

export interface M8JobScheduler {
  scheduleMetadata(input: {
    ownerId: string;
    resourceType: "file" | "folder";
    resourceId: string;
    correlationId?: string | null;
  }): Promise<string>;
  scheduleThumbnail(input: {
    ownerId: string;
    fileVersionId: string;
    correlationId?: string | null;
  }): Promise<string>;
  scheduleCleanup(input: {
    ownerId: string;
    uploadSessionId: string;
    correlationId?: string | null;
  }): Promise<string>;
}

export class BullMqM8QueueAdapter implements M8QueueAdapter {
  private readonly metadataQueue: Queue<MetadataIndexingJobPayload>;
  private readonly thumbnailQueue: Queue<ThumbnailGenerationJobPayload>;
  private readonly cleanupQueue: Queue<ObjectCleanupJobPayload>;

  constructor(redisUrl: string) {
    const connection = createBullMqConnectionOptions(redisUrl);
    this.metadataQueue = new Queue(METADATA_INDEXING_QUEUE_NAME, { connection });
    this.thumbnailQueue = new Queue(THUMBNAIL_GENERATION_QUEUE_NAME, { connection });
    this.cleanupQueue = new Queue(OBJECT_CLEANUP_QUEUE_NAME, { connection });
  }

  async enqueueMetadata(input: MetadataIndexingJobPayload) {
    const job = await this.metadataQueue.add("index", input, jobOptions(input.backgroundJobId));
    return { bullmqJobId: job.id ?? input.backgroundJobId };
  }

  async enqueueThumbnail(input: ThumbnailGenerationJobPayload) {
    const job = await this.thumbnailQueue.add(
      "thumbnail",
      input,
      jobOptions(input.backgroundJobId),
    );
    return { bullmqJobId: job.id ?? input.backgroundJobId };
  }

  async enqueueCleanup(input: ObjectCleanupJobPayload) {
    const job = await this.cleanupQueue.add("cleanup", input, jobOptions(input.backgroundJobId));
    return { bullmqJobId: job.id ?? input.backgroundJobId };
  }

  async close() {
    await Promise.all([
      this.metadataQueue.close(),
      this.thumbnailQueue.close(),
      this.cleanupQueue.close(),
    ]);
  }
}

export class PrismaM8JobScheduler implements M8JobScheduler {
  constructor(
    private readonly queue: M8QueueAdapter,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  scheduleMetadata(input: {
    ownerId: string;
    resourceType: "file" | "folder";
    resourceId: string;
    correlationId?: string | null;
  }): Promise<string> {
    return this.schedule({
      ownerId: input.ownerId,
      queueName: METADATA_INDEXING_QUEUE_NAME,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      correlationId: input.correlationId,
      enqueue: (backgroundJobId) =>
        this.queue.enqueueMetadata({
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          backgroundJobId,
          correlationId: input.correlationId,
        }),
    });
  }

  scheduleThumbnail(input: {
    ownerId: string;
    fileVersionId: string;
    correlationId?: string | null;
  }): Promise<string> {
    return this.schedule({
      ownerId: input.ownerId,
      queueName: THUMBNAIL_GENERATION_QUEUE_NAME,
      resourceType: "file_version",
      resourceId: input.fileVersionId,
      correlationId: input.correlationId,
      enqueue: (backgroundJobId) =>
        this.queue.enqueueThumbnail({
          fileVersionId: input.fileVersionId,
          backgroundJobId,
          correlationId: input.correlationId,
        }),
    });
  }

  scheduleCleanup(input: {
    ownerId: string;
    uploadSessionId: string;
    correlationId?: string | null;
  }): Promise<string> {
    return this.schedule({
      ownerId: input.ownerId,
      queueName: OBJECT_CLEANUP_QUEUE_NAME,
      resourceType: "upload_session",
      resourceId: input.uploadSessionId,
      correlationId: input.correlationId,
      enqueue: (backgroundJobId) =>
        this.queue.enqueueCleanup({
          uploadSessionId: input.uploadSessionId,
          backgroundJobId,
          correlationId: input.correlationId,
        }),
    });
  }

  private async schedule(input: {
    ownerId: string;
    queueName: string;
    resourceType: string;
    resourceId: string;
    correlationId?: string | null;
    enqueue: (backgroundJobId: string) => Promise<{ bullmqJobId: string }>;
  }): Promise<string> {
    const job = await this.prisma.backgroundJob.create({
      data: {
        ownerId: input.ownerId,
        queueName: input.queueName,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        status: "queued",
        maxAttempts: 3,
        correlationId: input.correlationId,
      },
    });

    try {
      const queued = await input.enqueue(job.id);
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: { bullmqJobId: queued.bullmqJobId },
      });
    } catch {
      await this.prisma.backgroundJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          failureCode: "queue_enqueue_failed",
          lastError: "queue_enqueue_failed",
          completedAt: new Date(),
        },
      });
    }

    return job.id;
  }
}

function jobOptions(jobId: string) {
  return {
    jobId,
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: false,
    removeOnFail: false,
  };
}

function createBullMqConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}
