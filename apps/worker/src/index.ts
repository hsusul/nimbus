import { getWorkerConfig } from "@nimbus/config";
import { createLogger } from "@nimbus/logger";
import { S3CompatibleStorageProvider } from "@nimbus/storage";
import { Worker } from "bullmq";

import {
  finalizeUploadSession,
  markUploadFinalizationJobDeadLettered,
  UPLOAD_FINALIZATION_QUEUE_NAME,
} from "./jobs/upload-finalization";
import { createBullMqConnectionOptions, createRedisConnection, registeredQueues } from "./queues";

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
  },
  {
    connection: createBullMqConnectionOptions(config.redisUrl),
    concurrency: 2,
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

uploadFinalizationWorker.on("failed", (job, error) => {
  logger.error("upload_finalization_failed", {
    job_id: job?.id,
    background_job_id: job?.data.backgroundJobId,
    upload_session_id: job?.data.uploadSessionId,
    correlation_id: job?.data.correlationId,
    attempts_made: job?.attemptsMade,
    error: error.message,
  });

  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void markUploadFinalizationJobDeadLettered(job.data.backgroundJobId, error);
  }
});

async function main() {
  await connection.ping();

  logger.info("worker_started", {
    registeredQueues: [...registeredQueues],
    message: "Worker is running registered job processors.",
  });
}

main().catch((error: unknown) => {
  logger.error("worker_start_failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  logger.info("worker_stopping");
  await uploadFinalizationWorker.close();
  connection.disconnect();
  process.exit(0);
}
