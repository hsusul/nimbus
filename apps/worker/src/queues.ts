import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

export const registeredQueues = [] as const;

export type RegisteredQueueName = (typeof registeredQueues)[number];

export function createRedisConnection(redisUrl: string): IORedis {
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}

export function createBullMqConnectionOptions(redisUrl: string): ConnectionOptions {
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

export function createQueue(name: RegisteredQueueName, redisUrl: string): Queue {
  return new Queue(name, {
    connection: createBullMqConnectionOptions(redisUrl),
  });
}
