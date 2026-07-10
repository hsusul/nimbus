import "./types";

import { getApiConfig, type ApiConfig } from "@nimbus/config";
import { createLogger, type Logger } from "@nimbus/logger";
import { S3CompatibleStorageProvider, type ObjectStorageProvider } from "@nimbus/storage";
import cors from "cors";
import express from "express";

import { devAuthMiddleware } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestIdMiddleware } from "./middleware/request-id";
import { auditLogsRouter } from "./routes/audit-logs";
import { filesRouter } from "./routes/files";
import { foldersRouter } from "./routes/folders";
import { healthRouter } from "./routes/health";
import { jobsRouter } from "./routes/jobs";
import { meRouter } from "./routes/me";
import { readyRouter } from "./routes/ready";
import { publicRouter } from "./routes/public";
import { shareLinksRouter } from "./routes/share-links";
import { sharesRouter } from "./routes/shares";
import { searchRouter } from "./routes/search";
import { uploadsRouter } from "./routes/uploads";
import { trashRouter } from "./routes/trash";
import { PrismaAuditLogService, type AuditLogService } from "./services/audit-log";
import { PrismaDownloadService, type DownloadService } from "./services/downloads";
import { PrismaFileService, type FileService } from "./services/files";
import { PrismaFolderService, type FolderService } from "./services/folders";
import { PrismaJobService, type JobService } from "./services/jobs";
import {
  BullMqM8QueueAdapter,
  type M8JobScheduler,
  PrismaM8JobScheduler,
} from "./services/m8-jobs";
import { PrismaPermissionService, type PermissionService } from "./services/permission-service";
import { BullMqUploadFinalizationQueue, type UploadFinalizationQueue } from "./services/queue";
import { createReadinessChecker, type ReadinessChecker } from "./services/readiness";
import { PrismaUploadService, type UploadService } from "./services/uploads";
import { PrismaUserService, type UserService } from "./services/users";
import { PrismaVersionService, type VersionService } from "./services/versions";
import { PrismaShareLinkService, type ShareLinkService } from "./services/share-links";
import { PrismaShareService, type ShareService } from "./services/shares";
import { PrismaSearchService, type SearchService } from "./services/search";
import { PrismaThumbnailService, type ThumbnailService } from "./services/thumbnails";
import { PrismaTrashService, type TrashService } from "./services/trash";

export interface AppDependencies {
  config?: ApiConfig;
  logger?: Logger;
  readinessChecker?: ReadinessChecker;
  userService?: UserService;
  folderService?: FolderService;
  fileService?: FileService;
  auditLogService?: AuditLogService;
  storageProvider?: ObjectStorageProvider;
  uploadFinalizationQueue?: UploadFinalizationQueue;
  uploadService?: UploadService;
  downloadService?: DownloadService;
  versionService?: VersionService;
  permissionService?: PermissionService;
  shareService?: ShareService;
  shareLinkService?: ShareLinkService;
  searchService?: SearchService;
  jobService?: JobService;
  thumbnailService?: ThumbnailService;
  m8JobScheduler?: M8JobScheduler;
  trashService?: TrashService;
}

export function createApp(dependencies: AppDependencies = {}) {
  const config = dependencies.config ?? getApiConfig();
  const logger =
    dependencies.logger ??
    createLogger({
      service: "nimbus-api",
      level: config.logLevel,
    });
  const readinessChecker = dependencies.readinessChecker ?? createReadinessChecker(config.redisUrl);
  const userService = dependencies.userService ?? new PrismaUserService();
  const permissionService = dependencies.permissionService ?? new PrismaPermissionService();
  const m8JobScheduler =
    dependencies.m8JobScheduler ??
    new PrismaM8JobScheduler(new BullMqM8QueueAdapter(config.redisUrl));
  const folderService =
    dependencies.folderService ??
    new PrismaFolderService(undefined, config.maxFolderDepth, m8JobScheduler);
  const fileService =
    dependencies.fileService ?? new PrismaFileService(permissionService, undefined, m8JobScheduler);
  const auditLogService = dependencies.auditLogService ?? new PrismaAuditLogService();
  const storageProvider =
    dependencies.storageProvider ??
    new S3CompatibleStorageProvider({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      accessKey: config.storage.accessKey,
      secretKey: config.storage.secretKey,
    });
  const uploadFinalizationQueue =
    dependencies.uploadFinalizationQueue ?? new BullMqUploadFinalizationQueue(config.redisUrl);
  const uploadService =
    dependencies.uploadService ??
    new PrismaUploadService(
      storageProvider,
      uploadFinalizationQueue,
      {
        bucket: config.storage.bucket,
        maxFileSizeBytes: config.maxFileSizeBytes,
        signedUploadUrlTtlSeconds: config.signedUploadUrlTtlSeconds,
        uploadSessionTtlSeconds: config.uploadSessionTtlSeconds,
        multipartUploadThresholdBytes: config.multipartUploadThresholdBytes,
        multipartChunkSizeBytes: config.multipartChunkSizeBytes,
      },
      permissionService,
      undefined,
      m8JobScheduler,
    );
  const downloadService =
    dependencies.downloadService ??
    new PrismaDownloadService(
      storageProvider,
      {
        signedDownloadUrlTtlSeconds: config.signedDownloadUrlTtlSeconds,
      },
      permissionService,
    );
  const versionService = dependencies.versionService ?? new PrismaVersionService(permissionService);
  const shareService = dependencies.shareService ?? new PrismaShareService(permissionService);
  const shareLinkService =
    dependencies.shareLinkService ?? new PrismaShareLinkService(permissionService, downloadService);
  const searchService = dependencies.searchService ?? new PrismaSearchService();
  const jobService = dependencies.jobService ?? new PrismaJobService();
  const thumbnailService =
    dependencies.thumbnailService ??
    new PrismaThumbnailService(
      storageProvider,
      permissionService,
      config.signedDownloadUrlTtlSeconds,
    );
  const trashService = dependencies.trashService ?? new PrismaTrashService();
  const app = express();

  app.disable("x-powered-by");
  app.use(
    cors({
      origin: config.corsOrigin,
    }),
  );
  app.use(express.json());
  app.use(requestIdMiddleware);
  app.use((req, _res, next) => {
    logger.info("request_started", {
      request_id: req.context.requestId,
      method: req.method,
      path: redactPublicTokenPath(req.path),
    });
    next();
  });
  app.use(devAuthMiddleware(config));
  app.use(healthRouter());
  app.use(readyRouter(readinessChecker));
  app.use(meRouter(userService));
  app.use(foldersRouter(folderService, userService));
  app.use(uploadsRouter(uploadService, userService));
  app.use(filesRouter(fileService, userService, downloadService, versionService, thumbnailService));
  app.use(searchRouter(searchService, userService));
  app.use(jobsRouter(jobService, userService));
  app.use(trashRouter(trashService, userService));
  app.use(sharesRouter(shareService, userService));
  app.use(shareLinksRouter(shareLinkService, userService));
  app.use(publicRouter(shareLinkService));
  app.use(auditLogsRouter(auditLogService, userService));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function redactPublicTokenPath(path: string): string {
  return path.replace(/^(\/api\/v1\/public\/)[^/]+/, "$1[REDACTED]");
}
