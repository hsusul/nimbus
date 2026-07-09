import { resolveDevUser } from "@nimbus/auth";
import type { ApiConfig } from "@nimbus/config";
import type { NextFunction, Request, Response } from "express";

import { HttpError } from "./error-handler";

export function devAuthMiddleware(config: Pick<ApiConfig, "devAuthEnabled">) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = resolveDevUser(req.headers, {
      enabled: config.devAuthEnabled,
    });

    if (user) {
      req.context.authenticatedUser = user;
    }

    next();
  };
}

export function requireAuthenticatedUser(req: Request) {
  if (!req.context.authenticatedUser) {
    throw new HttpError(401, "unauthenticated", "Authentication is required.");
  }

  return req.context.authenticatedUser;
}
