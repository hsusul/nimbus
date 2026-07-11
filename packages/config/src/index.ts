import { z } from "zod";

const LOCAL_DATABASE_URL = "postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public";
const LOCAL_REDIS_URL = "redis://localhost:6379";
const LOCAL_STORAGE_ENDPOINT = "http://localhost:9000";
const LOCAL_WEB_URL = "http://localhost:3000";
const LOCAL_API_URL = "http://localhost:4000";

function booleanFromEnv(defaultValue: boolean) {
  return z
    .union([z.boolean(), z.enum(["1", "0", "true", "false", "yes", "no", "on", "off"])])
    .optional()
    .default(defaultValue)
    .transform((value) =>
      typeof value === "boolean" ? value : ["1", "true", "yes", "on"].includes(value),
    );
}

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional().default("development"),
  DEPLOYMENT_PROFILE: z.enum(["local", "test", "ci", "production"]).optional().default("local"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
});

const dbEnvSchema = z.object({
  DATABASE_URL: z.string().url().optional().default(LOCAL_DATABASE_URL),
});

const redisEnvSchema = z.object({
  REDIS_URL: z.string().url().optional().default(LOCAL_REDIS_URL),
});

const storageEnvSchema = z.object({
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: booleanFromEnv(true),
  MINIO_ENDPOINT: z.string().url().optional().default(LOCAL_STORAGE_ENDPOINT),
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

const authEnvSchema = z.object({
  AUTH_MODE: z.enum(["dev", "authjs"]).optional().default("dev"),
  DEV_AUTH_ENABLED: booleanFromEnv(true),
  AUTH_SECRET: z.string().optional(),
  AUTH_GITHUB_ID: z.string().optional(),
  AUTH_GITHUB_SECRET: z.string().optional(),
  AUTH_TRUST_HOST: booleanFromEnv(false),
  AUTH_SESSION_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(2592000)
    .optional()
    .default(86400),
  API_AUTH_SECRET: z.string().optional(),
  API_AUTH_ISSUER: z.string().min(1).optional().default("nimbus-web"),
  API_AUTH_AUDIENCE: z.string().min(1).optional().default("nimbus-api"),
  API_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(900).optional().default(300),
});

const apiEnvSchema = z.object({
  API_HOST: z.string().min(1).optional().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65535).optional().default(4000),
  PUBLIC_WEB_URL: z.string().url().optional().default(LOCAL_WEB_URL),
  PUBLIC_API_URL: z.string().url().optional().default(LOCAL_API_URL),
  CORS_ORIGIN: z.string().url().optional().default(LOCAL_WEB_URL),
  ALLOWED_WEB_ORIGINS: z.string().optional(),
  TRUST_PROXY: booleanFromEnv(false),
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
  RATE_LIMIT_ENABLED: booleanFromEnv(true),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).optional().default(60),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().min(1).max(10000).optional().default(60),
  RATE_LIMIT_SEARCH_MAX: z.coerce.number().int().min(1).max(10000).optional().default(120),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).max(10000).optional().default(60),
  RATE_LIMIT_SIGNED_URL_MAX: z.coerce.number().int().min(1).max(10000).optional().default(120),
});

const webEnvSchema = z.object({
  WEB_PORT: z.coerce.number().int().positive().max(65535).optional().default(3000),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().optional().default(LOCAL_API_URL),
  WEB_DEV_AUTH_USER: z
    .string()
    .regex(/^[a-z0-9._-]{1,64}$/)
    .optional(),
  WEB_DEV_AUTH_EMAIL: z.string().email().optional(),
  WEB_DEV_AUTH_NAME: z.string().min(1).max(120).optional(),
});

const workerEnvSchema = z.object({
  THUMBNAIL_MAX_INPUT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(104857600)
    .optional()
    .default(20971520),
  THUMBNAIL_MAX_PIXEL_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .max(100000000)
    .optional()
    .default(40000000),
  THUMBNAIL_MAX_WIDTH: z.coerce.number().int().positive().max(30000).optional().default(12000),
  THUMBNAIL_MAX_HEIGHT: z.coerce.number().int().positive().max(30000).optional().default(12000),
  THUMBNAIL_OUTPUT_WIDTH: z.coerce.number().int().positive().max(2048).optional().default(320),
  THUMBNAIL_OUTPUT_HEIGHT: z.coerce.number().int().positive().max(2048).optional().default(320),
  THUMBNAIL_PROCESSING_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .optional()
    .default(15000),
  UPLOAD_FINALIZATION_CONCURRENCY: z.coerce.number().int().min(1).max(20).optional().default(2),
  METADATA_INDEXING_CONCURRENCY: z.coerce.number().int().min(1).max(20).optional().default(5),
  THUMBNAIL_GENERATION_CONCURRENCY: z.coerce.number().int().min(1).max(8).optional().default(2),
  OBJECT_CLEANUP_CONCURRENCY: z.coerce.number().int().min(1).max(20).optional().default(3),
});

const demoEnvSchema = z.object({
  DEMO_MODE: booleanFromEnv(false),
  DEMO_RESET_ENABLED: booleanFromEnv(false),
});

export const appEnvSchema = baseEnvSchema
  .merge(dbEnvSchema)
  .merge(redisEnvSchema)
  .merge(storageEnvSchema)
  .merge(authEnvSchema)
  .merge(apiEnvSchema)
  .merge(webEnvSchema)
  .merge(workerEnvSchema)
  .merge(demoEnvSchema);

export type AppConfig = z.infer<typeof appEnvSchema>;
export type ApiConfig = ReturnType<typeof getApiConfig>;
export type WorkerConfig = ReturnType<typeof getWorkerConfig>;
export type WebConfig = ReturnType<typeof getWebConfig>;
export type DbConfig = ReturnType<typeof getDbConfig>;
export type RedisConfig = ReturnType<typeof getRedisConfig>;
export type StorageConfig = ReturnType<typeof getStorageConfig>;
export type DeploymentProfile = AppConfig["DEPLOYMENT_PROFILE"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const normalized = normalizeProfile(env);
  const config = appEnvSchema.parse(normalized);
  if (config.DEPLOYMENT_PROFILE === "production") {
    validateProductionCommon(config, normalized);
    validateProductionApi(config, normalized);
    validateProductionWeb(config, normalized);
    validateProductionStorage(config, normalized);
  }
  return config;
}

export function getApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeProfile(env);
  const config = baseEnvSchema
    .merge(dbEnvSchema)
    .merge(redisEnvSchema)
    .merge(storageEnvSchema)
    .merge(authEnvSchema)
    .merge(apiEnvSchema)
    .parse(normalized);
  if (config.DEPLOYMENT_PROFILE === "production") {
    validateProductionCommon(config, normalized);
    validateProductionApi(config, normalized);
    validateProductionStorage(config, normalized);
  }

  return {
    nodeEnv: config.NODE_ENV,
    deploymentProfile: config.DEPLOYMENT_PROFILE,
    logLevel: config.LOG_LEVEL,
    host: config.API_HOST,
    port: config.API_PORT,
    publicWebUrl: config.PUBLIC_WEB_URL,
    publicApiUrl: config.PUBLIC_API_URL,
    allowedWebOrigins: parseOrigins(config.ALLOWED_WEB_ORIGINS ?? config.CORS_ORIGIN),
    corsOrigin: config.CORS_ORIGIN,
    trustProxy: config.TRUST_PROXY,
    authMode: config.AUTH_MODE,
    devAuthEnabled:
      config.NODE_ENV !== "production" &&
      config.DEPLOYMENT_PROFILE !== "production" &&
      config.AUTH_MODE === "dev"
        ? config.DEV_AUTH_ENABLED
        : false,
    apiAuth: {
      secret: config.API_AUTH_SECRET ?? "",
      issuer: config.API_AUTH_ISSUER,
      audience: config.API_AUTH_AUDIENCE,
      tokenTtlSeconds: config.API_ACCESS_TOKEN_TTL_SECONDS,
    },
    rateLimit: {
      enabled: config.RATE_LIMIT_ENABLED,
      windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS,
      publicMax: config.RATE_LIMIT_PUBLIC_MAX,
      searchMax: config.RATE_LIMIT_SEARCH_MAX,
      writeMax: config.RATE_LIMIT_WRITE_MAX,
      signedUrlMax: config.RATE_LIMIT_SIGNED_URL_MAX,
    },
    maxFolderDepth: config.MAX_FOLDER_DEPTH,
    maxFileSizeBytes: config.MAX_FILE_SIZE_BYTES,
    signedUploadUrlTtlSeconds: config.SIGNED_UPLOAD_URL_TTL_SECONDS,
    signedDownloadUrlTtlSeconds: config.SIGNED_DOWNLOAD_URL_TTL_SECONDS,
    uploadSessionTtlSeconds: config.UPLOAD_SESSION_TTL_SECONDS,
    multipartUploadThresholdBytes: config.MULTIPART_UPLOAD_THRESHOLD_BYTES,
    multipartChunkSizeBytes: config.MULTIPART_CHUNK_SIZE_BYTES,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    storage: mapStorageConfig(config),
  };
}

export function getWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeProfile(env);
  const config = baseEnvSchema
    .merge(dbEnvSchema)
    .merge(redisEnvSchema)
    .merge(storageEnvSchema)
    .merge(workerEnvSchema)
    .parse(normalized);
  if (config.DEPLOYMENT_PROFILE === "production") {
    validateProductionCommon(config, normalized);
    validateProductionStorage(config, normalized);
    requireSourceValues(normalized, ["DATABASE_URL", "REDIS_URL"]);
  }

  return {
    nodeEnv: config.NODE_ENV,
    deploymentProfile: config.DEPLOYMENT_PROFILE,
    logLevel: config.LOG_LEVEL,
    databaseUrl: config.DATABASE_URL,
    redisUrl: config.REDIS_URL,
    storage: mapStorageConfig(config),
    thumbnail: {
      maxInputBytes: config.THUMBNAIL_MAX_INPUT_BYTES,
      maxPixelCount: config.THUMBNAIL_MAX_PIXEL_COUNT,
      maxWidth: config.THUMBNAIL_MAX_WIDTH,
      maxHeight: config.THUMBNAIL_MAX_HEIGHT,
      outputWidth: config.THUMBNAIL_OUTPUT_WIDTH,
      outputHeight: config.THUMBNAIL_OUTPUT_HEIGHT,
      processingTimeoutMs: config.THUMBNAIL_PROCESSING_TIMEOUT_MS,
    },
    concurrency: {
      uploadFinalization: config.UPLOAD_FINALIZATION_CONCURRENCY,
      metadataIndexing: config.METADATA_INDEXING_CONCURRENCY,
      thumbnailGeneration: config.THUMBNAIL_GENERATION_CONCURRENCY,
      objectCleanup: config.OBJECT_CLEANUP_CONCURRENCY,
    },
  };
}

export function getWebConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeProfile(env);
  const config = baseEnvSchema
    .merge(authEnvSchema)
    .merge(apiEnvSchema)
    .merge(webEnvSchema)
    .parse(normalized);
  if (config.DEPLOYMENT_PROFILE === "production") {
    validateProductionCommon(config, normalized);
    validateProductionWeb(config, normalized);
  }

  return {
    nodeEnv: config.NODE_ENV,
    deploymentProfile: config.DEPLOYMENT_PROFILE,
    port: config.WEB_PORT,
    publicWebUrl: config.PUBLIC_WEB_URL,
    apiBaseUrl: config.NEXT_PUBLIC_API_BASE_URL,
    authMode: config.AUTH_MODE,
    auth: {
      secret: config.AUTH_SECRET ?? "",
      githubId: config.AUTH_GITHUB_ID ?? "",
      githubSecret: config.AUTH_GITHUB_SECRET ?? "",
      trustHost: config.AUTH_TRUST_HOST,
      sessionMaxAgeSeconds: config.AUTH_SESSION_MAX_AGE_SECONDS,
    },
    apiAuth: {
      secret: config.API_AUTH_SECRET ?? "",
      issuer: config.API_AUTH_ISSUER,
      audience: config.API_AUTH_AUDIENCE,
      tokenTtlSeconds: config.API_ACCESS_TOKEN_TTL_SECONDS,
    },
    devAuth:
      config.DEPLOYMENT_PROFILE !== "production" &&
      config.NODE_ENV !== "production" &&
      config.AUTH_MODE === "dev" &&
      config.WEB_DEV_AUTH_USER
        ? {
            user: config.WEB_DEV_AUTH_USER,
            email: config.WEB_DEV_AUTH_EMAIL,
            name: config.WEB_DEV_AUTH_NAME,
          }
        : null,
  };
}

export function getDbConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeProfile(env);
  const config = baseEnvSchema.merge(dbEnvSchema).parse(normalized);
  if (config.DEPLOYMENT_PROFILE === "production") {
    requireSourceValues(normalized, ["DATABASE_URL"]);
  }
  return { databaseUrl: config.DATABASE_URL };
}

export function getRedisConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeProfile(env);
  const config = baseEnvSchema.merge(redisEnvSchema).parse(normalized);
  if (config.DEPLOYMENT_PROFILE === "production") {
    requireSourceValues(normalized, ["REDIS_URL"]);
  }
  return { redisUrl: config.REDIS_URL };
}

export function getStorageConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeProfile(env);
  const config = baseEnvSchema.merge(storageEnvSchema).parse(normalized);
  if (config.DEPLOYMENT_PROFILE === "production") {
    validateProductionStorage(config, normalized);
  }
  return mapStorageConfig(config);
}

export function getDemoConfig(env: NodeJS.ProcessEnv = process.env) {
  const normalized = normalizeProfile(env);
  const config = baseEnvSchema.merge(demoEnvSchema).parse(normalized);
  return {
    deploymentProfile: config.DEPLOYMENT_PROFILE,
    enabled: config.DEMO_MODE,
    resetEnabled: config.DEMO_RESET_ENABLED,
  };
}

function normalizeProfile(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const profile =
    env.DEPLOYMENT_PROFILE ?? (env.CI ? "ci" : env.NODE_ENV === "test" ? "test" : "local");
  return { ...env, DEPLOYMENT_PROFILE: profile };
}

function mapStorageConfig(config: z.infer<typeof storageEnvSchema>) {
  return {
    endpoint: config.S3_ENDPOINT ?? config.MINIO_ENDPOINT,
    accessKey: config.S3_ACCESS_KEY_ID ?? config.MINIO_ACCESS_KEY,
    secretKey: config.S3_SECRET_ACCESS_KEY ?? config.MINIO_SECRET_KEY,
    bucket: config.S3_BUCKET ?? config.MINIO_BUCKET,
    region: config.S3_REGION ?? config.MINIO_REGION,
    forcePathStyle: config.S3_ENDPOINT ? config.S3_FORCE_PATH_STYLE : true,
    signedUploadUrlTtlSeconds: config.SIGNED_UPLOAD_URL_TTL_SECONDS,
    signedDownloadUrlTtlSeconds: config.SIGNED_DOWNLOAD_URL_TTL_SECONDS,
  };
}

function validateProductionCommon(
  config: { NODE_ENV: string; DEPLOYMENT_PROFILE: string },
  _env: NodeJS.ProcessEnv,
) {
  if (config.NODE_ENV !== "production" || config.DEPLOYMENT_PROFILE !== "production") {
    throw new Error(
      "Production deployment requires NODE_ENV=production and DEPLOYMENT_PROFILE=production.",
    );
  }
}

function validateProductionApi(
  config: z.infer<typeof baseEnvSchema & typeof apiEnvSchema & typeof authEnvSchema>,
  env: NodeJS.ProcessEnv,
) {
  requireSourceValues(env, [
    "DATABASE_URL",
    "REDIS_URL",
    "PUBLIC_WEB_URL",
    "PUBLIC_API_URL",
    "ALLOWED_WEB_ORIGINS",
    "API_AUTH_SECRET",
  ]);
  if (config.AUTH_MODE !== "authjs" || config.DEV_AUTH_ENABLED) {
    throw new Error("Production API requires AUTH_MODE=authjs and DEV_AUTH_ENABLED=false.");
  }
  validateHttpsUrl(config.PUBLIC_WEB_URL, "PUBLIC_WEB_URL");
  validateHttpsUrl(config.PUBLIC_API_URL, "PUBLIC_API_URL");
  validateSecret(config.API_AUTH_SECRET, "API_AUTH_SECRET");
  if (!parseOrigins(config.ALLOWED_WEB_ORIGINS ?? "").includes(config.PUBLIC_WEB_URL)) {
    throw new Error("ALLOWED_WEB_ORIGINS must include PUBLIC_WEB_URL.");
  }
}

function validateProductionWeb(
  config: z.infer<
    typeof baseEnvSchema & typeof apiEnvSchema & typeof webEnvSchema & typeof authEnvSchema
  >,
  env: NodeJS.ProcessEnv,
) {
  requireSourceValues(env, [
    "PUBLIC_WEB_URL",
    "PUBLIC_API_URL",
    "NEXT_PUBLIC_API_BASE_URL",
    "AUTH_SECRET",
    "AUTH_GITHUB_ID",
    "AUTH_GITHUB_SECRET",
    "API_AUTH_SECRET",
  ]);
  if (config.AUTH_MODE !== "authjs" || config.DEV_AUTH_ENABLED) {
    throw new Error("Production web requires AUTH_MODE=authjs and DEV_AUTH_ENABLED=false.");
  }
  if (!config.AUTH_TRUST_HOST) {
    throw new Error(
      "Production Auth.js requires AUTH_TRUST_HOST=true behind the deployment proxy.",
    );
  }
  validateHttpsUrl(config.PUBLIC_WEB_URL, "PUBLIC_WEB_URL");
  validateHttpsUrl(config.PUBLIC_API_URL, "PUBLIC_API_URL");
  validateHttpsUrl(config.NEXT_PUBLIC_API_BASE_URL, "NEXT_PUBLIC_API_BASE_URL");
  if (config.NEXT_PUBLIC_API_BASE_URL !== config.PUBLIC_API_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL must equal PUBLIC_API_URL in production.");
  }
  validateSecret(config.AUTH_SECRET, "AUTH_SECRET");
  validateSecret(config.AUTH_GITHUB_SECRET, "AUTH_GITHUB_SECRET");
  validateSecret(config.API_AUTH_SECRET, "API_AUTH_SECRET");
}

function validateProductionStorage(
  config: z.infer<typeof baseEnvSchema & typeof storageEnvSchema>,
  env: NodeJS.ProcessEnv,
) {
  requireSourceValues(env, [
    "S3_ENDPOINT",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
    "S3_REGION",
  ]);
  validateHttpsUrl(config.S3_ENDPOINT ?? "", "S3_ENDPOINT");
  validateSecret(config.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY");
}

function requireSourceValues(env: NodeJS.ProcessEnv, keys: string[]) {
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production configuration: ${missing.join(", ")}.`);
  }
}

function validateHttpsUrl(value: string, name: string) {
  if (new URL(value).protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production.`);
  }
}

function validateSecret(value: string | undefined, name: string) {
  if (!value || value.length < 32 || /(change|example|placeholder|nimbus-secret)/i.test(value)) {
    throw new Error(`${name} must be a non-placeholder secret of at least 32 characters.`);
  }
}

function parseOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);
  return [...new Set(origins)];
}
