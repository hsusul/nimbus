import "./types";

import { getApiConfig, type ApiConfig } from "@nimbus/config";
import { createLogger, type Logger } from "@nimbus/logger";
import cors from "cors";
import express from "express";

import { devAuthMiddleware } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestIdMiddleware } from "./middleware/request-id";
import { auditLogsRouter } from "./routes/audit-logs";
import { filesRouter } from "./routes/files";
import { foldersRouter } from "./routes/folders";
import { healthRouter } from "./routes/health";
import { meRouter } from "./routes/me";
import { readyRouter } from "./routes/ready";
import { PrismaAuditLogService, type AuditLogService } from "./services/audit-log";
import { PrismaFileService, type FileService } from "./services/files";
import { PrismaFolderService, type FolderService } from "./services/folders";
import { createReadinessChecker, type ReadinessChecker } from "./services/readiness";
import { PrismaUserService, type UserService } from "./services/users";

export interface AppDependencies {
  config?: ApiConfig;
  logger?: Logger;
  readinessChecker?: ReadinessChecker;
  userService?: UserService;
  folderService?: FolderService;
  fileService?: FileService;
  auditLogService?: AuditLogService;
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
  const folderService =
    dependencies.folderService ?? new PrismaFolderService(undefined, config.maxFolderDepth);
  const fileService = dependencies.fileService ?? new PrismaFileService();
  const auditLogService = dependencies.auditLogService ?? new PrismaAuditLogService();
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
      path: req.path,
    });
    next();
  });
  app.use(devAuthMiddleware(config));
  app.use(healthRouter());
  app.use(readyRouter(readinessChecker));
  app.use(meRouter(userService));
  app.use(foldersRouter(folderService, userService));
  app.use(filesRouter(fileService, userService));
  app.use(auditLogsRouter(auditLogService, userService));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
