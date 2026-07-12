import type { ApiKeyScope } from "@nimbus/contracts";
import type { NextFunction, Request, Response } from "express";

import { HttpError } from "./error-handler";

export type ApiKeyRoutePolicy =
  | { access: "public" }
  | { access: "browser_only" }
  | { access: "api_key_management" }
  | { access: "api_key"; scope: ApiKeyScope | null };

type RouteRule = {
  method: string;
  pattern: RegExp;
  policy: ApiKeyRoutePolicy;
};

const apiKey = (scope: ApiKeyScope | null): ApiKeyRoutePolicy => ({ access: "api_key", scope });
const publicRoute: ApiKeyRoutePolicy = { access: "public" };
const browserOnly: ApiKeyRoutePolicy = { access: "browser_only" };
const keyManagement: ApiKeyRoutePolicy = { access: "api_key_management" };

export const API_KEY_ROUTE_RULES: readonly RouteRule[] = [
  { method: "GET", pattern: /^\/(?:health|ready)$/, policy: publicRoute },
  { method: "GET", pattern: /^\/api\/v1\/openapi\.json$/, policy: publicRoute },
  { method: "GET", pattern: /^\/api\/v1\/public\/[^/]+$/, policy: publicRoute },
  { method: "*", pattern: /^\/api\/v1\/api-keys(?:\/[^/]+)?$/, policy: keyManagement },
  { method: "GET", pattern: /^\/api\/v1\/audit-logs$/, policy: browserOnly },
  { method: "GET", pattern: /^\/api\/v1\/me$/, policy: apiKey(null) },
  {
    method: "GET",
    pattern: /^\/api\/v1\/folders\/[^/]+(?:\/children)?$/,
    policy: apiKey("files:read"),
  },
  { method: "POST", pattern: /^\/api\/v1\/folders$/, policy: apiKey("files:write") },
  { method: "PATCH", pattern: /^\/api\/v1\/folders\/[^/]+$/, policy: apiKey("files:write") },
  { method: "POST", pattern: /^\/api\/v1\/folders\/[^/]+\/move$/, policy: apiKey("files:write") },
  { method: "DELETE", pattern: /^\/api\/v1\/folders\/[^/]+$/, policy: apiKey("files:write") },
  {
    method: "POST",
    pattern: /^\/api\/v1\/folders\/[^/]+\/restore$/,
    policy: apiKey("trash:write"),
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/files(?:\/[^/]+(?:\/(?:download|versions|thumbnail))?)?$/,
    policy: apiKey("files:read"),
  },
  { method: "POST", pattern: /^\/api\/v1\/files$/, policy: apiKey("files:write") },
  { method: "PATCH", pattern: /^\/api\/v1\/files\/[^/]+$/, policy: apiKey("files:write") },
  { method: "POST", pattern: /^\/api\/v1\/files\/[^/]+\/move$/, policy: apiKey("files:write") },
  { method: "DELETE", pattern: /^\/api\/v1\/files\/[^/]+$/, policy: apiKey("files:write") },
  { method: "POST", pattern: /^\/api\/v1\/files\/[^/]+\/restore$/, policy: apiKey("trash:write") },
  {
    method: "POST",
    pattern: /^\/api\/v1\/files\/[^/]+\/versions\/[^/]+\/restore$/,
    policy: apiKey("files:write"),
  },
  { method: "POST", pattern: /^\/api\/v1\/uploads\/start$/, policy: apiKey("uploads:write") },
  { method: "GET", pattern: /^\/api\/v1\/uploads\/[^/]+$/, policy: apiKey("uploads:write") },
  {
    method: "GET",
    pattern: /^\/api\/v1\/uploads\/[^/]+\/chunks$/,
    policy: apiKey("uploads:write"),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/uploads\/[^/]+\/chunks$/,
    policy: apiKey("uploads:write"),
  },
  {
    method: "POST",
    pattern: /^\/api\/v1\/uploads\/[^/]+\/(?:complete|cancel)$/,
    policy: apiKey("uploads:write"),
  },
  { method: "GET", pattern: /^\/api\/v1\/search$/, policy: apiKey("files:read") },
  { method: "GET", pattern: /^\/api\/v1\/jobs(?:\/[^/]+)?$/, policy: apiKey("jobs:read") },
  { method: "GET", pattern: /^\/api\/v1\/trash$/, policy: apiKey("trash:read") },
  { method: "POST", pattern: /^\/api\/v1\/shares$/, policy: apiKey("shares:write") },
  {
    method: "GET",
    pattern: /^\/api\/v1\/resources\/[^/]+\/[^/]+\/shares$/,
    policy: apiKey("shares:read"),
  },
  { method: "DELETE", pattern: /^\/api\/v1\/shares\/[^/]+$/, policy: apiKey("shares:write") },
  { method: "POST", pattern: /^\/api\/v1\/share-links$/, policy: apiKey("shares:write") },
  { method: "GET", pattern: /^\/api\/v1\/share-links\/[^/]+$/, policy: apiKey("shares:read") },
  { method: "DELETE", pattern: /^\/api\/v1\/share-links\/[^/]+$/, policy: apiKey("shares:write") },
];

export function apiKeyRoutePolicy(method: string, path: string): ApiKeyRoutePolicy | null {
  return (
    API_KEY_ROUTE_RULES.find(
      (rule) => (rule.method === "*" || rule.method === method) && rule.pattern.test(path),
    )?.policy ?? null
  );
}

export function apiKeyScopeMiddleware(req: Request, _res: Response, next: NextFunction) {
  const auth = req.context.authentication;
  if (auth?.type !== "api_key") return next();
  const policy = apiKeyRoutePolicy(req.method, req.path);
  if (!policy || policy.access === "browser_only")
    return next(
      new HttpError(403, "api_key_route_unsupported", "API keys cannot access this route."),
    );
  if (policy.access === "api_key_management")
    return next(
      new HttpError(
        403,
        "browser_authentication_required",
        "API key management requires browser authentication.",
      ),
    );
  if (policy.access === "public" || policy.scope === null || auth.scopes.includes(policy.scope))
    return next();
  return next(
    new HttpError(
      403,
      "insufficient_api_key_scope",
      `This API key requires the ${policy.scope} scope.`,
    ),
  );
}
