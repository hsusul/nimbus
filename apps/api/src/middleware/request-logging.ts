import type { ApiConfig } from "@nimbus/config";
import type { Logger } from "@nimbus/logger";
import type { NextFunction, Request, Response } from "express";

export function requestLoggingMiddleware(
  logger: Logger,
  config: Pick<ApiConfig, "deploymentProfile">,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = process.hrtime.bigint();
    res.once("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info("request_completed", {
        environment: config.deploymentProfile,
        request_id: req.context.requestId,
        correlation_id: req.header("x-correlation-id"),
        method: req.method,
        route: safeRouteTemplate(req),
        status_code: res.statusCode,
        duration_ms: Math.round(durationMs * 100) / 100,
      });
    });
    next();
  };
}

function safeRouteTemplate(req: Request): string {
  const route = req.route?.path;
  if (typeof route === "string") {
    return `${req.baseUrl}${route}`.replace(":token", "[REDACTED]");
  }
  return req.path
    .replace(/^(\/api\/v1\/public\/)[^/]+/, "$1[REDACTED]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
    .replace(/\bcm[a-z0-9]{20,}\b/gi, ":id");
}
