import {
  UPLOAD_FINALIZATION_QUEUE_NAME,
  type UploadFinalizationJobPayload,
} from "@nimbus/contracts";
import { Queue, type ConnectionOptions } from "bullmq";

export interface UploadFinalizationQueue {
  enqueueUploadFinalization(input: UploadFinalizationJobPayload): Promise<{ bullmqJobId: string }>;
}

export class BullMqUploadFinalizationQueue implements UploadFinalizationQueue {
  private readonly queue: Queue<UploadFinalizationJobPayload>;

  constructor(redisUrl: string) {
    this.queue = new Queue<UploadFinalizationJobPayload>(UPLOAD_FINALIZATION_QUEUE_NAME, {
      connection: createBullMqConnectionOptions(redisUrl),
    });
  }

  async enqueueUploadFinalization(
    input: UploadFinalizationJobPayload,
  ): Promise<{ bullmqJobId: string }> {
    const job = await this.queue.add("finalize", input, {
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      removeOnComplete: false,
      removeOnFail: false,
    });

    return {
      bullmqJobId: job.id ?? input.backgroundJobId,
    };
  }
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
