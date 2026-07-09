import type { ApiConfig } from "@nimbus/config";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import type { UserService } from "../src/services/users";

const testConfig: ApiConfig = {
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
  databaseUrl: "postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public",
  redisUrl: "redis://localhost:6379",
  storage: {
    endpoint: "http://localhost:9000",
    accessKey: "nimbus",
    secretKey: "nimbus-secret",
    bucket: "nimbus-local",
    region: "us-east-1",
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
});
