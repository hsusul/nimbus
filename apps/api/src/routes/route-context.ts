import type { Request } from "express";

import { requireAuthenticatedUser } from "../middleware/auth";
import { HttpError } from "../middleware/error-handler";
import type { AuditContext } from "../services/audit-log";
import type { PublicAuditContext } from "../services/downloads";
import type { InternalUser, UserService } from "../services/users";

export async function requireActiveInternalUser(
  req: Request,
  userService: UserService,
): Promise<InternalUser> {
  const identity = requireAuthenticatedUser(req);
  const user = await userService.ensureUser(identity);

  if (user.status === "disabled") {
    throw new HttpError(403, "account_disabled", "This account is disabled.");
  }

  return user;
}

export function getAuditContext(req: Request, actorUserId: string): AuditContext {
  return {
    actorUserId,
    requestId: req.context.requestId,
    correlationId: req.header("x-correlation-id") ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}

export function getPublicAuditContext(req: Request): PublicAuditContext {
  return {
    requestId: req.context.requestId,
    correlationId: req.header("x-correlation-id") ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.header("user-agent") ?? null,
  };
}
