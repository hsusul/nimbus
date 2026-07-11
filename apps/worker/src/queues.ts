import {
  METADATA_INDEXING_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
  THUMBNAIL_GENERATION_QUEUE_NAME,
  UPLOAD_FINALIZATION_QUEUE_NAME,
} from "@nimbus/contracts";
import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

export const registeredQueues = [
  UPLOAD_FINALIZATION_QUEUE_NAME,
  METADATA_INDEXING_QUEUE_NAME,
  THUMBNAIL_GENERATION_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
] as const;

export type RegisteredQueueName = (typeof registeredQueues)[number];

export function createRedisConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export function createBullMqConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);

  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error(`Unsupported Redis URL protocol: ${url.protocol}`);
  }

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

export function createQueue<T>(name: RegisteredQueueName, redisUrl: string): Queue<T> {
  return new Queue<T>(name, {
    connection: createBullMqConnectionOptions(redisUrl),
  });
}
