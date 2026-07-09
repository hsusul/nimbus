import { describe, expect, it } from "vitest";

import { getApiConfig, getStorageConfig, loadConfig } from "../src/index";

describe("config validation", () => {
  it("loads valid local defaults", () => {
    const config = loadConfig({});

    expect(config.DATABASE_URL).toBe(
      "postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public",
    );
    expect(config.REDIS_URL).toBe("redis://localhost:6379");
    expect(config.DEV_AUTH_ENABLED).toBe(true);
  });

  it("parses service-specific config", () => {
    const apiConfig = getApiConfig({
      API_PORT: "4100",
      DEV_AUTH_ENABLED: "true",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
      REDIS_URL: "redis://localhost:6380",
    });
    const storageConfig = getStorageConfig({
      MINIO_ENDPOINT: "http://localhost:9000",
      MINIO_ACCESS_KEY: "access",
      MINIO_SECRET_KEY: "secret",
      MINIO_BUCKET: "bucket",
      MINIO_REGION: "us-east-1",
    });

    expect(apiConfig.port).toBe(4100);
    expect(apiConfig.devAuthEnabled).toBe(true);
    expect(storageConfig.bucket).toBe("bucket");
  });

  it("rejects invalid URLs and ports", () => {
    expect(() =>
      getApiConfig({
        DATABASE_URL: "not-a-url",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toThrow();

    expect(() =>
      getApiConfig({
        API_PORT: "-1",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toThrow();
  });
});
