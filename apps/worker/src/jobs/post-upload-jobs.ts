import {
  METADATA_INDEXING_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
  THUMBNAIL_GENERATION_QUEUE_NAME,
  type MetadataIndexingJobPayload,
  type ObjectCleanupJobPayload,
  type ThumbnailGenerationJobPayload,
} from "@nimbus/contracts";
import { getPrismaClient, Prisma, type BackgroundJob, type PrismaClient } from "@nimbus/db";
import type { Queue } from "bullmq";

const THUMBNAIL_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface PostUploadQueues {
  metadata: Queue<MetadataIndexingJobPayload>;
  thumbnail: Queue<ThumbnailGenerationJobPayload>;
  cleanup: Queue<ObjectCleanupJobPayload>;
}

export async function schedulePostUploadJobs(
  uploadSessionId: string,
  queues: PostUploadQueues,
  prisma: PrismaClient = getPrismaClient(),
): Promise<void> {
  const session = await prisma.uploadSession.findUnique({
    where: { id: uploadSessionId },
    include: { fileVersion: { include: { file: true } } },
  });

  if (!session) return;

  if (["failed", "canceled", "expired"].includes(session.status)) {
    await scheduleOnce(
      prisma,
      {
        ownerId: session.ownerId,
        queueName: OBJECT_CLEANUP_QUEUE_NAME,
        resourceType: "upload_session",
        resourceId: session.id,
        correlationId: `${session.id}:cleanup`,
      },
      async (backgroundJobId) => {
        const job = await queues.cleanup.add(
          "cleanup",
          {
            uploadSessionId: session.id,
            backgroundJobId,
            correlationId: session.correlationId,
          },
          jobOptions(backgroundJobId),
        );
        return job.id ?? backgroundJobId;
      },
    );
    return;
  }

  const version = session.fileVersion;
  if (session.status !== "completed" || !version) return;

  await scheduleOnce(
    prisma,
    {
      ownerId: version.file.ownerId,
      queueName: METADATA_INDEXING_QUEUE_NAME,
      resourceType: "file",
      resourceId: version.fileId,
      correlationId: `${session.id}:metadata`,
    },
    async (backgroundJobId) => {
      const job = await queues.metadata.add(
        "index",
        {
          resourceType: "file",
          resourceId: version.fileId,
          backgroundJobId,
          correlationId: session.correlationId,
        },
        jobOptions(backgroundJobId),
      );
      return job.id ?? backgroundJobId;
    },
  );

  if (THUMBNAIL_MIME_TYPES.has(version.mimeType)) {
    await prisma.thumbnail.upsert({
      where: { fileVersionId: version.id },
      create: {
        ownerId: version.file.ownerId,
        fileId: version.fileId,
        fileVersionId: version.id,
        status: "pending",
      },
      update: {},
    });
    await scheduleOnce(
      prisma,
      {
        ownerId: version.file.ownerId,
        queueName: THUMBNAIL_GENERATION_QUEUE_NAME,
        resourceType: "file_version",
        resourceId: version.id,
        correlationId: `${session.id}:thumbnail`,
      },
      async (backgroundJobId) => {
        const job = await queues.thumbnail.add(
          "thumbnail",
          {
            fileVersionId: version.id,
            backgroundJobId,
            correlationId: session.correlationId,
          },
          jobOptions(backgroundJobId),
        );
        return job.id ?? backgroundJobId;
      },
    );
  }
}

export async function schedulePendingCleanupJobs(
  queues: PostUploadQueues,
  prisma: PrismaClient = getPrismaClient(),
  options: { ownerId?: string } = {},
): Promise<number> {
  const expired = await prisma.uploadSession.findMany({
    where: {
      ...(options.ownerId ? { ownerId: options.ownerId } : {}),
      status: { in: ["created", "uploading"] },
      expiresAt: { lte: new Date() },
    },
    take: 100,
  });

  for (const session of expired) {
    await prisma.$transaction(async (tx) => {
      const result = await tx.uploadSession.updateMany({
        where: {
          id: session.id,
          status: { in: ["created", "uploading"] },
          expiresAt: { lte: new Date() },
        },
        data: { status: "expired", failureReason: "upload_session_expired" },
      });
      if (result.count === 1 && session.uploadMode === "new_file" && session.targetFileId) {
        await tx.file.updateMany({
          where: {
            id: session.targetFileId,
            status: "uploading",
            currentVersionId: null,
          },
          data: { status: "failed" },
        });
      }
    });
  }

  const terminal = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT session.id
    FROM upload_sessions AS session
    LEFT JOIN background_jobs AS job
      ON job.dedupe_key = session.id || ':cleanup'
    WHERE session.status IN ('expired', 'failed', 'canceled')
      ${options.ownerId ? Prisma.sql`AND session.owner_id = ${options.ownerId}` : Prisma.empty}
      AND (
        job.id IS NULL
        OR (job.status = 'failed' AND job.failure_code = 'queue_enqueue_failed')
      )
    ORDER BY session.updated_at ASC, session.id ASC
    LIMIT 100
  `);
  for (const session of terminal) {
    await schedulePostUploadJobs(session.id, queues, prisma);
  }

  const completed = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT session.id
    FROM upload_sessions AS session
    INNER JOIN file_versions AS version
      ON version.upload_session_id = session.id
    LEFT JOIN background_jobs AS metadata_job
      ON metadata_job.dedupe_key = session.id || ':metadata'
    LEFT JOIN background_jobs AS thumbnail_job
      ON thumbnail_job.dedupe_key = session.id || ':thumbnail'
    WHERE session.status = 'completed'
      ${options.ownerId ? Prisma.sql`AND session.owner_id = ${options.ownerId}` : Prisma.empty}
      AND (
        metadata_job.id IS NULL
        OR (
          metadata_job.status = 'failed'
          AND metadata_job.failure_code = 'queue_enqueue_failed'
        )
        OR (
          version.mime_type IN ('image/jpeg', 'image/png', 'image/webp')
          AND (
            thumbnail_job.id IS NULL
            OR (
              thumbnail_job.status = 'failed'
              AND thumbnail_job.failure_code = 'queue_enqueue_failed'
            )
          )
        )
      )
    ORDER BY session.updated_at ASC, session.id ASC
    LIMIT 100
  `);
  for (const session of completed) {
    await schedulePostUploadJobs(session.id, queues, prisma);
  }

  return terminal.length + completed.length;
}

async function scheduleOnce(
  prisma: PrismaClient,
  input: {
    ownerId: string;
    queueName: string;
    resourceType: string;
    resourceId: string;
    correlationId: string;
  },
  enqueue: (backgroundJobId: string) => Promise<string>,
) {
  let durableJob: BackgroundJob;
  try {
    durableJob = await prisma.backgroundJob.create({
      data: {
        ownerId: input.ownerId,
        queueName: input.queueName,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        correlationId: input.correlationId,
        dedupeKey: input.correlationId,
        status: "queued",
        maxAttempts: 3,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const existing = await prisma.backgroundJob.findUnique({
      where: { dedupeKey: input.correlationId },
    });
    if (!existing) throw error;
    if (
      existing.status !== "queued" &&
      !(existing.status === "failed" && existing.failureCode === "queue_enqueue_failed")
    ) {
      return existing.id;
    }
    durableJob = await prisma.backgroundJob.update({
      where: { id: existing.id },
      data: {
        status: "queued",
        failureCode: null,
        lastError: null,
        completedAt: null,
      },
    });
  }

  try {
    const bullmqJobId = await enqueue(durableJob.id);
    await prisma.backgroundJob.update({
      where: { id: durableJob.id },
      data: { bullmqJobId },
    });
  } catch {
    await prisma.backgroundJob.update({
      where: { id: durableJob.id },
      data: {
        status: "failed",
        failureCode: "queue_enqueue_failed",
        lastError: "queue_enqueue_failed",
        completedAt: new Date(),
      },
    });
  }

  return durableJob.id;
}

function jobOptions(jobId: string) {
  return {
    jobId,
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 1000 },
    removeOnComplete: false,
    removeOnFail: false,
  };
}
