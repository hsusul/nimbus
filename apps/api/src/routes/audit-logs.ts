import { CursorPaginationQuerySchema } from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { AuditLogService } from "../services/audit-log";
import type { UserService } from "../services/users";
import { requireActiveInternalUser } from "./route-context";

export function auditLogsRouter(
  auditLogService: AuditLogService,
  userService: UserService,
): Router {
  const router = createRouter();

  router.get("/api/v1/audit-logs", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const pagination = CursorPaginationQuerySchema.parse(req.query);
      const page = await auditLogService.listForUser(actor.id, pagination);

      res.json({
        data: {
          auditLogs: page.items,
          pageInfo: page.pageInfo,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
