import type { ApiConfig } from "@nimbus/config";
import type { NextFunction, Request, Response } from "express";

import { HttpError } from "./error-handler";

export function securityHeadersMiddleware(config: Pick<ApiConfig, "deploymentProfile">) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "content-security-policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    res.setHeader("cross-origin-resource-policy", "same-site");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");
    if (config.deploymentProfile === "production") {
      res.setHeader("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

export function trustedOriginMiddleware(config: Pick<ApiConfig, "allowedWebOrigins">) {
  const allowed = new Set(config.allowedWebOrigins);
  return (req: Request, _res: Response, next: NextFunction) => {
    const origin = req.header("origin");
    if (origin && !allowed.has(origin)) {
      next(new HttpError(403, "origin_not_allowed", "The request origin is not allowed."));
      return;
    }
    next();
  };
}
