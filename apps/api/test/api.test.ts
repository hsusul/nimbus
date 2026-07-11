import { issueApiAccessToken } from "@nimbus/auth";
import { getApiConfig, type ApiConfig } from "@nimbus/config";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { MemoryRateLimitStore } from "../src/middleware/rate-limit";
import type { M8JobScheduler } from "../src/services/m8-jobs";
import type { UploadFinalizationQueue } from "../src/services/queue";
import type { SearchService } from "../src/services/search";
import type { UserService } from "../src/services/users";

const testConfig: ApiConfig = {
  ...getApiConfig({ NODE_ENV: "test", DEPLOYMENT_PROFILE: "test" }),
  nodeEnv: "test",
  logLevel: "error",
  host: "127.0.0.1",
  port: 0,
  corsOrigin: "http://localhost:3000",
  authMode: "dev",
  devAuthEnabled: true,
  maxFolderDepth: 32,
  maxFileSizeBytes: 5368709120,
  signedUploadUrlTtlSeconds: 900,
  signedDownloadUrlTtlSeconds: 300,
  uploadSessionTtlSeconds: 86400,
  multipartUploadThresholdBytes: 67108864,
  multipartChunkSizeBytes: 8388608,
  databaseUrl: "postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public",
  redisUrl: "redis://localhost:6379",
  storage: {
    endpoint: "http://localhost:9000",
    accessKey: "nimbus",
    secretKey: "nimbus-secret",
    bucket: "nimbus-local",
    region: "us-east-1",
    forcePathStyle: true,
    signedUploadUrlTtlSeconds: 900,
    signedDownloadUrlTtlSeconds: 300,
  },
};

const userService: UserService = {
  async ensureUser(identity) {
    return {
      id: "usr_test",
      email: identity.email,
      displayName: identity.displayName,
      status: "active",
      storageQuotaBytes: 5368709120n,
      storageUsedBytes: 0n,
      rootFolderId: "fld_root",
    };
  },
};

const searchService: SearchService = {
  async search() {
    return { items: [], pageInfo: { hasMore: false, nextCursor: null } };
  },
};
const noOpM8Scheduler: M8JobScheduler = {
  async scheduleMetadata() {
    return "job_metadata";
  },
  async scheduleThumbnail() {
    return "job_thumbnail";
  },
  async scheduleCleanup() {
    return "job_cleanup";
  },
};
const noOpUploadQueue: UploadFinalizationQueue = {
  async enqueueUploadFinalization() {
    return { bullmqJobId: "job_upload" };
  },
};

describe("api foundation routes", () => {
  it("returns health", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
    });

    const response = await request(app).get("/health").expect(200);

    expect(response.body.data.status).toBe("ok");
    expect(response.body.data.requestId).toBeDefined();
  });

  it("returns ready when dependencies are available", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
    });

    const response = await request(app).get("/ready").expect(200);

    expect(response.body.data.status).toBe("ready");
    expect(response.body.data.dependencies).toEqual({
      postgres: true,
      redis: true,
    });
  });

  it("serves generated OpenAPI JSON without authentication", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
    });

    const response = await request(app).get("/api/v1/openapi.json").expect(200);
    expect(response.body.openapi).toBe("3.0.3");
    expect(response.body.paths["/api/v1/uploads/start"]).toBeDefined();
  });

  it("returns not ready when a dependency is unavailable", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: false }),
      userService,
    });

    const response = await request(app).get("/ready").expect(503);

    expect(response.body.data.status).toBe("not_ready");
    expect(response.body.data.dependencies.redis).toBe(false);
  });

  it("returns the authenticated development user", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
    });

    const response = await request(app)
      .get("/api/v1/me")
      .set("x-nimbus-dev-user", "test-user")
      .set("x-nimbus-dev-email", "test@example.com")
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: "usr_test",
      email: "test@example.com",
      displayName: "Test User",
      status: "active",
      rootFolderId: "fld_root",
    });
  });

  it("requires authentication for /api/v1/me", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
    });

    const response = await request(app).get("/api/v1/me").expect(401);

    expect(response.body.error.code).toBe("unauthenticated");
  });

  it("sets production security headers and rejects untrusted browser origins", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
    });

    const response = await request(app).get("/health").expect(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");

    const rejected = await request(app)
      .get("/health")
      .set("origin", "https://untrusted.example.test")
      .expect(403);
    expect(rejected.body.error.code).toBe("origin_not_allowed");
  });

  it("allows the explicit local browser authentication headers in CORS preflights", async () => {
    const app = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
    });

    const response = await request(app)
      .options("/api/v1/me")
      .set("origin", "http://localhost:3000")
      .set("access-control-request-method", "GET")
      .set("access-control-request-headers", "x-nimbus-dev-user,x-nimbus-dev-email")
      .expect(204);

    expect(response.headers["access-control-allow-headers"]).toContain("x-nimbus-dev-user");
  });

  it("enforces targeted limits with a stable retry contract", async () => {
    const app = createApp({
      config: {
        ...testConfig,
        rateLimit: { ...testConfig.rateLimit, searchMax: 2, windowSeconds: 60 },
      },
      readinessChecker: async () => ({ postgres: true, redis: true }),
      userService,
      searchService,
      rateLimitStore: new MemoryRateLimitStore(),
    });
    const search = () =>
      request(app)
        .get("/api/v1/search?q=nimbus")
        .set("x-nimbus-dev-user", "rate-test")
        .set("x-nimbus-dev-email", "rate-test@example.test");

    await search().expect(200);
    await search().expect(200);
    const blocked = await search().expect(429);
    expect(blocked.headers["retry-after"]).toBe("60");
    expect(blocked.body.error.code).toBe("rate_limit_exceeded");
  });
});

describe("production authentication", () => {
  const secret = "production-auth-secret-value-with-32-plus-characters";
  const productionConfig = getApiConfig({
    NODE_ENV: "production",
    DEPLOYMENT_PROFILE: "production",
    AUTH_MODE: "authjs",
    DEV_AUTH_ENABLED: "false",
    PUBLIC_WEB_URL: "https://nimbus.example.com",
    PUBLIC_API_URL: "https://api.nimbus.example.com",
    ALLOWED_WEB_ORIGINS: "https://nimbus.example.com",
    DATABASE_URL: "postgresql://user:password@db.example.com:5432/nimbus",
    REDIS_URL: "rediss://default:password@redis.example.com:6379",
    API_AUTH_SECRET: secret,
    S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "production-access-key",
    S3_SECRET_ACCESS_KEY: `${secret}-storage`,
    S3_BUCKET: "nimbus-production",
    S3_REGION: "auto",
    S3_FORCE_PATH_STYLE: "false",
  });

  it("accepts a correctly scoped web access token", async () => {
    const app = createApp({
      config: productionConfig,
      userService,
      rateLimitStore: new MemoryRateLimitStore(),
      m8JobScheduler: noOpM8Scheduler,
      uploadFinalizationQueue: noOpUploadQueue,
    });
    const accessToken = await issueApiAccessToken(
      {
        authSubject: "github:123456",
        email: "demo-owner@example.test",
        displayName: "Demo Owner",
      },
      {
        ...productionConfig.apiAuth,
        expiresInSeconds: productionConfig.apiAuth.tokenTtlSeconds,
      },
    );

    const response = await request(app)
      .get("/api/v1/me")
      .set("authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(response.body.data.email).toBe("demo-owner@example.test");
  });

  it("ignores development identity headers and rejects invalid bearer tokens", async () => {
    const app = createApp({
      config: productionConfig,
      userService,
      rateLimitStore: new MemoryRateLimitStore(),
      m8JobScheduler: noOpM8Scheduler,
      uploadFinalizationQueue: noOpUploadQueue,
    });

    await request(app).get("/api/v1/me").set("x-nimbus-dev-user", "impersonated").expect(401);
    const invalid = await request(app)
      .get("/api/v1/me")
      .set("authorization", "Bearer invalid.token.value")
      .expect(401);
    expect(invalid.body.error.code).toBe("invalid_access_token");
  });

  it("rejects a valid session identity when the internal user is disabled", async () => {
    const disabledUserService: UserService = {
      async ensureUser(identity) {
        return { ...(await userService.ensureUser(identity)), status: "disabled" };
      },
    };
    const app = createApp({
      config: productionConfig,
      userService: disabledUserService,
      rateLimitStore: new MemoryRateLimitStore(),
      m8JobScheduler: noOpM8Scheduler,
      uploadFinalizationQueue: noOpUploadQueue,
    });
    const accessToken = await issueApiAccessToken(
      {
        authSubject: "github:disabled",
        email: "disabled@example.test",
        displayName: "Disabled User",
      },
      {
        ...productionConfig.apiAuth,
        expiresInSeconds: productionConfig.apiAuth.tokenTtlSeconds,
      },
    );

    const response = await request(app)
      .get("/api/v1/me")
      .set("authorization", `Bearer ${accessToken}`)
      .expect(403);
    expect(response.body.error.code).toBe("account_disabled");
  });
});
