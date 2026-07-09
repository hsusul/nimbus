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
    expect(config.MAX_FOLDER_DEPTH).toBe(32);
    expect(config.MAX_FILE_SIZE_BYTES).toBe(5368709120);
    expect(config.SIGNED_UPLOAD_URL_TTL_SECONDS).toBe(900);
    expect(config.SIGNED_DOWNLOAD_URL_TTL_SECONDS).toBe(300);
    expect(config.UPLOAD_SESSION_TTL_SECONDS).toBe(86400);
    expect(config.MULTIPART_UPLOAD_THRESHOLD_BYTES).toBe(67108864);
    expect(config.MULTIPART_CHUNK_SIZE_BYTES).toBe(8388608);
  });

  it("parses service-specific config", () => {
    const apiConfig = getApiConfig({
      API_PORT: "4100",
      DEV_AUTH_ENABLED: "true",
      MAX_FOLDER_DEPTH: "24",
      MAX_FILE_SIZE_BYTES: "1024",
      SIGNED_UPLOAD_URL_TTL_SECONDS: "600",
      SIGNED_DOWNLOAD_URL_TTL_SECONDS: "120",
      UPLOAD_SESSION_TTL_SECONDS: "3600",
      MULTIPART_UPLOAD_THRESHOLD_BYTES: "10485760",
      MULTIPART_CHUNK_SIZE_BYTES: "5242880",
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
    expect(apiConfig.maxFolderDepth).toBe(24);
    expect(apiConfig.maxFileSizeBytes).toBe(1024);
    expect(apiConfig.signedUploadUrlTtlSeconds).toBe(600);
    expect(apiConfig.signedDownloadUrlTtlSeconds).toBe(120);
    expect(apiConfig.uploadSessionTtlSeconds).toBe(3600);
    expect(apiConfig.multipartUploadThresholdBytes).toBe(10485760);
    expect(apiConfig.multipartChunkSizeBytes).toBe(5242880);
    expect(storageConfig.bucket).toBe("bucket");
    expect(storageConfig.signedDownloadUrlTtlSeconds).toBe(300);
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

    expect(() =>
      getApiConfig({
        MAX_FILE_SIZE_BYTES: "0",
        DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
        REDIS_URL: "redis://localhost:6379",
      }),
    ).toThrow();
  });
});
