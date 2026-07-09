import { z } from "zod";

function booleanFromEnv(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.string()])
    .optional()
    .default(defaultValue)
    .transform((value) => {
      if (typeof value === "boolean") {
        return value;
      }

      return ["1", "true", "yes", "on"].includes(value.toLowerCase());
    });
}

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional().default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
});

const dbEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .optional()
    .default("postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public"),
});

const redisEnvSchema = z.object({
  REDIS_URL: z.string().url().optional().default("redis://localhost:6379"),
});

const storageEnvSchema = z.object({
  MINIO_ENDPOINT: z.string().url().optional().default("http://localhost:9000"),
  MINIO_ACCESS_KEY: z.string().min(1).optional().default("nimbus"),
  MINIO_SECRET_KEY: z.string().min(1).optional().default("nimbus-secret"),
  MINIO_BUCKET: z.string().min(1).optional().default("nimbus-local"),
  MINIO_REGION: z.string().min(1).optional().default("us-east-1"),
  SIGNED_UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).optional().default(900),
  SIGNED_DOWNLOAD_URL_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .optional()
    .default(300),
});

const apiEnvSchema = z.object({
  API_HOST: z.string().min(1).optional().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65535).optional().default(4000),
  CORS_ORIGIN: z.string().url().optional().default("http://localhost:3000"),
  AUTH_MODE: z.enum(["dev", "authjs"]).optional().default("dev"),
  DEV_AUTH_ENABLED: booleanFromEnv(true),
  MAX_FOLDER_DEPTH: z.coerce.number().int().positive().max(128).optional().default(32),
  MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .default(5368709120),
  UPLOAD_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(604800)
    .optional()
    .default(86400),
  MULTIPART_UPLOAD_THRESHOLD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .default(67108864),
  MULTIPART_CHUNK_SIZE_BYTES: z.coerce
    .number()
    .int()
    .min(5242880)
    .max(Number.MAX_SAFE_INTEGER)
    .optional()
    .default(8388608),
});

const webEnvSchema = z.object({
  WEB_PORT: z.coerce.number().int().positive().max(65535).optional().default(3000),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().optional().default("http://localhost:4000"),
});

export const appEnvSchema = baseEnvSchema
  .merge(dbEnvSchema)
  .merge(redisEnvSchema)
  .merge(storageEnvSchema)
  .merge(apiEnvSchema)
  .merge(webEnvSchema);

export type AppConfig = z.infer<typeof appEnvSchema>;
export type ApiConfig = ReturnType<typeof getApiConfig>;
export type WorkerConfig = ReturnType<typeof getWorkerConfig>;
export type WebConfig = ReturnType<typeof getWebConfig>;
export type DbConfig = ReturnType<typeof getDbConfig>;
export type RedisConfig = ReturnType<typeof getRedisConfig>;
export type StorageConfig = ReturnType<typeof getStorageConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return appEnvSchema.parse(env);
}

export function getApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  return {
    nodeEnv: config.NODE_ENV,
    logLevel: config.LOG_LEVEL,
    host: config.API_HOST,
    port: config.API_PORT,
    corsOrigin: config.CORS_ORIGIN,
    authMode: config.AUTH_MODE,
    devAuthEnabled: config.DEV_AUTH_ENABLED,
    maxFolderDepth: config.MAX_FOLDER_DEPTH,
    maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES,
    signedUploadUrlTtlSeconds: config.SIGNED_UPLOAD_URL_TTL_SECONDS,
    signedDownloadUrlTtlSeconds: config.SIGNED_DOWNLOAD_URL_TTL_SECONDS,
    uploadSessionTtlSeconds: config.UPLOAD_SESSION_TTL_SECONDS,
    multipartUploadThresholdBytes: config.MULTIPART_UPLOAD_THRESHOLD_BYTES,
    multipartChunkSizeBytes: config.MULTIPART_CHUNK_SIZE_BYTES,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    storage: getStorageConfig(env),
  };
}

export function getWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  return {
    nodeEnv: config.NODE_ENV,
    logLevel: config.LOG_LEVEL,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    storage: getStorageConfig(env),
  };
}

export function getWebConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  return {
    nodeEnv: config.NODE_ENV,
    port: config.WEB_PORT,
    apiBaseUrl: config.NEXT_PUBLIC_API_BASE_URL,
  };
}

export function getDbConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  return {
    databaseUrl: config.DATABASE_URL,
  };
}

export function getRedisConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  return {
    redisUrl: config.REDIS_URL,
  };
}

export function getStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = loadConfig(env);

  return {
    endpoint: config.MINIO_ENDPOINT,
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
    bucket: config.MINIO_BUCKET,
    region: config.MINIO_REGION,
    signedUploadUrlTtlSeconds: config.SIGNED_UPLOAD_URL_TTL_SECONDS,
    signedDownloadUrlTtlSeconds: config.SIGNED_DOWNLOAD_URL_TTL_SECONDS,
  };
}
