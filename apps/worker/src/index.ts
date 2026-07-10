import { getWorkerConfig } from "@nimbus/config";
import type {
  MetadataIndexingJobPayload,
  ObjectCleanupJobPayload,
  ThumbnailGenerationJobPayload,
} from "@nimbus/contracts";
import { createLogger } from "@nimbus/logger";
import { S3CompatibleStorageProvider } from "@nimbus/storage";
import { Worker } from "bullmq";

import {
  finalizeUploadSession,
  markUploadFinalizationJobDeadLettered,
  UPLOAD_FINALIZATION_QUEUE_NAME,
} from "./jobs/upload-finalization";
import { indexResourceMetadata, METADATA_INDEXING_QUEUE_NAME } from "./jobs/metadata-indexing";
import { cleanupUploadArtifacts, OBJECT_CLEANUP_QUEUE_NAME } from "./jobs/object-cleanup";
import { generateThumbnail, THUMBNAIL_GENERATION_QUEUE_NAME } from "./jobs/thumbnail-generation";
import { markDurableJobDeadLettered } from "./jobs/job-state";
import { schedulePendingCleanupJobs, schedulePostUploadJobs } from "./jobs/post-upload-jobs";
import { createBullMqConnectionOptions, createRedisConnection, registeredQueues } from "./queues";
import { createQueue } from "./queues";

const config = getWorkerConfig();
const logger = createLogger({
  service: "nimbus-worker",
  level: config.logLevel,
});
const connection = createRedisConnection(config.redisUrl);
const storageProvider = new S3CompatibleStorageProvider({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  accessKey: config.storage.accessKey,
  secretKey: config.storage.secretKey,
});
const postUploadQueues = {
  metadata: createQueue<MetadataIndexingJobPayload>(METADATA_INDEXING_QUEUE_NAME, config.redisUrl),
  thumbnail: createQueue<ThumbnailGenerationJobPayload>(
    THUMBNAIL_GENERATION_QUEUE_NAME,
    config.redisUrl,
  ),
  cleanup: createQueue<ObjectCleanupJobPayload>(OBJECT_CLEANUP_QUEUE_NAME, config.redisUrl),
};
const uploadFinalizationWorker = new Worker(
  UPLOAD_FINALIZATION_QUEUE_NAME,
  async (job) => {
    logger.info("upload_finalization_started", {
      job_id: job.id,
      background_job_id: job.data.backgroundJobId,
      upload_session_id: job.data.uploadSessionId,
      correlation_id: job.data.correlationId,
      attempts_made: job.attemptsMade,
    });

    await finalizeUploadSession(job.data, {
      storage: storageProvider,
    });
    await schedulePostUploadJobs(job.data.uploadSessionId, postUploadQueues);
  },
  {
    connection: createBullMqConnectionOptions(config.redisUrl),
    concurrency: 2,
  },
);
const metadataIndexingWorker = new Worker(
  METADATA_INDEXING_QUEUE_NAME,
  async (job) => {
    await indexResourceMetadata(job.data);
  },
  {
    connection: createBullMqConnectionOptions(config.redisUrl),
    concurrency: config.concurrency.metadataIndexing,
  },
);
const thumbnailGenerationWorker = new Worker(
  THUMBNAIL_GENERATION_QUEUE_NAME,
  async (job) => {
    await generateThumbnail(job.data, {
      storage: storageProvider,
      limits: config.thumbnail,
    });
  },
  {
    connection: createBullMqConnectionOptions(config.redisUrl),
    concurrency: config.concurrency.thumbnailGeneration,
  },
);
const objectCleanupWorker = new Worker(
  OBJECT_CLEANUP_QUEUE_NAME,
  async (job) => {
    await cleanupUploadArtifacts(job.data, { storage: storageProvider });
  },
  {
    connection: createBullMqConnectionOptions(config.redisUrl),
    concurrency: config.concurrency.objectCleanup,
  },
);

uploadFinalizationWorker.on("completed", (job) => {
  logger.info("upload_finalization_completed", {
    job_id: job.id,
    background_job_id: job.data.backgroundJobId,
    upload_session_id: job.data.uploadSessionId,
    correlation_id: job.data.correlationId,
  });
});

uploadFinalizationWorker.on("failed", (job) => {
  logger.error("upload_finalization_failed", {
    job_id: job?.id,
    background_job_id: job?.data.backgroundJobId,
    upload_session_id: job?.data.uploadSessionId,
    correlation_id: job?.data.correlationId,
    attempts_made: job?.attemptsMade,
    failure_code: "upload_finalization_worker_failed",
  });

  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markUploadFinalizationJobDeadLettered(job.data.backgroundJobId);
  }
});

for (const worker of [metadataIndexingWorker, thumbnailGenerationWorker, objectCleanupWorker]) {
  worker.on("failed", (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      void markDurableJobDeadLettered(job.data.backgroundJobId, "worker_retries_exhausted");
    }
  });
}

async function main() {
  await connection.ping();
  await schedulePendingCleanupJobs(postUploadQueues);

  logger.info("worker_started", {
    registeredQueues: [...registeredQueues],
    message: "Worker is running registered job processors.",
  });
}

const cleanupSchedule = setInterval(() => {
  void schedulePendingCleanupJobs(postUploadQueues);
}, 60_000);

main().catch((error: unknown) => {
  logger.error("worker_start_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  clearInterval(cleanupSchedule);
  logger.info("worker_stopping");
  await uploadFinalizationWorker.close();
  await metadataIndexingWorker.close();
  await thumbnailGenerationWorker.close();
  await objectCleanupWorker.close();
  connection.disconnect();
  process.exit(0);
}
