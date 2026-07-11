import { createHash } from "node:crypto";

import type { ApiConfig } from "@nimbus/config";
import Redis from "ioredis";
import type { NextFunction, Request, Response } from "express";

import { HttpError } from "./error-handler";

export interface RateLimitStore {
  consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  close?(): Promise<void>;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
  }

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const [count, ttl] = (await this.redis.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('TTL', KEYS[1]); return {count, ttl}",
      1,
      key,
      windowSeconds,
    )) as [number, number];
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, ttl),
    };
  }

  async close() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, { count: number; resetsAt: number }>();

  async consume(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const current = this.entries.get(key);
    const entry =
      !current || current.resetsAt <= now
        ? { count: 0, resetsAt: now + windowSeconds * 1000 }
        : current;
    entry.count += 1;
    this.entries.set(key, entry);
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetsAt - now) / 1000)),
    };
  }
}

export function rateLimitMiddleware(config: Pick<ApiConfig, "rateLimit">, store: RateLimitStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!config.rateLimit.enabled) {
        next();
        return;
      }
      const policy = policyFor(req, config.rateLimit);
      if (!policy) {
        next();
        return;
      }
      const identity =
        req.context.authenticatedUser?.authSubject ??
        req.ip ??
        req.socket.remoteAddress ??
        "unknown";
      const identityHash = createHash("sha256").update(identity).digest("hex").slice(0, 24);
      const result = await store.consume(
        `nimbus:rate:${policy.name}:${identityHash}`,
        policy.limit,
        config.rateLimit.windowSeconds,
      );
      res.setHeader("x-ratelimit-limit", String(policy.limit));
      res.setHeader("x-ratelimit-remaining", String(result.remaining));
      if (!result.allowed) {
        res.setHeader("retry-after", String(result.retryAfterSeconds));
        next(
          new HttpError(429, "rate_limit_exceeded", "Too many requests. Try again later.", {
            retryAfterSeconds: result.retryAfterSeconds,
          }),
        );
        return;
      }
      next();
    } catch {
      next(new HttpError(503, "rate_limit_unavailable", "Request protection is unavailable."));
    }
  };
}

function policyFor(req: Request, config: ApiConfig["rateLimit"]) {
  if (req.path.startsWith("/api/v1/public/")) {
    return { name: "public", limit: config.publicMax };
  }
  if (req.path === "/api/v1/search") {
    return { name: "search", limit: config.searchMax };
  }
  if (
    (req.method === "POST" && req.path === "/api/v1/share-links") ||
    (req.method === "POST" && req.path === "/api/v1/uploads/start")
  ) {
    return { name: "write", limit: config.writeMax };
  }
  if (req.method === "GET" && (/\/download$/.test(req.path) || /\/thumbnail$/.test(req.path))) {
    return { name: "signed-url", limit: config.signedUrlMax };
  }
  return null;
}
