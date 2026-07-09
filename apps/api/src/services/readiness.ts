import { getPrismaClient } from "@nimbus/db";
import Redis from "ioredis";

export interface ReadinessResult {
  postgres: boolean;
  redis: boolean;
}

export type ReadinessChecker = () => Promise<ReadinessResult>;

export function createReadinessChecker(redisUrl: string): ReadinessChecker {
  return async () => {
    const [postgres, redis] = await Promise.all([checkPostgres(), checkRedis(redisUrl)]);

    return {
      postgres,
      redis,
    };
  };
}

async function checkPostgres(): Promise<boolean> {
  try {
    await getPrismaClient().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(redisUrl: string): Promise<boolean> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1000,
  });

  try {
    await redis.connect();
    const response = await redis.ping();
    return response === "PONG";
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}
