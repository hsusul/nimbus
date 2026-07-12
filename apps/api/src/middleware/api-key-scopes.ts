import type { ApiKeyScope } from "@nimbus/contracts";
import type { NextFunction, Request, Response } from "express";

import { HttpError } from "./error-handler";

export function apiKeyScopeMiddleware(req: Request, _res: Response, next: NextFunction) {
  const auth = req.context.authentication;
  if (auth?.type !== "api_key") return next();
  if (req.path.startsWith("/api/v1/api-keys")) return next();
  const required = requiredScope(req.method, req.path);
  if (required && !auth.scopes.includes(required))
    return next(
      new HttpError(
        403,
        "insufficient_api_key_scope",
        `This API key requires the ${required} scope.`,
      ),
    );
  next();
}

function requiredScope(method: string, path: string): ApiKeyScope | null {
  if (path === "/api/v1/me") return null;
  if (path.startsWith("/api/v1/uploads")) return "uploads:write";
  if (path.startsWith("/api/v1/search")) return "files:read";
  if (path.startsWith("/api/v1/jobs")) return "jobs:read";
  if (path.startsWith("/api/v1/trash")) return method === "GET" ? "trash:read" : "trash:write";
  if (
    path.startsWith("/api/v1/shares") ||
    path.startsWith("/api/v1/share-links") ||
    path.includes("/shares")
  )
    return method === "GET" ? "shares:read" : "shares:write";
  if (path.startsWith("/api/v1/folders") || path.startsWith("/api/v1/files"))
    return method === "GET" ? "files:read" : "files:write";
  if (path.startsWith("/api/v1/audit-logs")) return "files:read";
  return null;
}
