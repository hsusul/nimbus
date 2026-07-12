import { resolveDevUser, verifyApiAccessToken } from "@nimbus/auth";
import type { ApiConfig } from "@nimbus/config";
import type { NextFunction, Request, Response } from "express";

import { HttpError } from "./error-handler";
import type { ApiKeyService } from "../services/api-keys";

type AuthenticationConfig = Pick<
  ApiConfig,
  "authMode" | "devAuthEnabled" | "deploymentProfile" | "apiAuth"
>;

export function authenticationMiddleware(
  config: AuthenticationConfig,
  apiKeyService: ApiKeyService,
) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const token = readBearerToken(req.header("authorization"));
      if (token?.startsWith("nmb_live_")) {
        const authenticated = await apiKeyService.authenticate(token);
        if (!authenticated) throw new Error("Invalid API key.");
        req.context.authenticatedUser = authenticated.user;
        req.context.authentication = {
          type: "api_key",
          apiKeyId: authenticated.apiKeyId,
          scopes: authenticated.scopes,
        };
        next();
        return;
      }

      if (config.authMode === "authjs") {
        if (token) {
          req.context.authenticatedUser = await verifyApiAccessToken(token, {
            secret: config.apiAuth.secret,
            issuer: config.apiAuth.issuer,
            audience: config.apiAuth.audience,
          });
          req.context.authentication = { type: "browser_token" };
        }
        next();
        return;
      }

      if (config.deploymentProfile === "production") {
        next(new HttpError(500, "invalid_auth_configuration", "Authentication is unavailable."));
        return;
      }

      const user = resolveDevUser(req.headers, {
        enabled: config.devAuthEnabled,
      });
      if (user) {
        req.context.authenticatedUser = user;
        req.context.authentication = { type: "development" };
      }
      next();
    } catch {
      next(new HttpError(401, "invalid_access_token", "The access token is invalid or expired."));
    }
  };
}

export function requireAuthenticatedUser(req: Request) {
  if (!req.context.authenticatedUser) {
    throw new HttpError(401, "unauthenticated", "Authentication is required.");
  }
  return req.context.authenticatedUser;
}

function readBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value);
  if (!match?.[1]) {
    throw new Error("Malformed bearer token.");
  }
  return match[1];
}
