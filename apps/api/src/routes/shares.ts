import { ShareCreateRequestSchema, ShareResourceTypeSchema } from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { ShareService } from "../services/shares";
import type { UserService } from "../services/users";
import { getAuditContext, requireActiveInternalUser } from "./route-context";

export function sharesRouter(shareService: ShareService, userService: UserService): Router {
  const router = createRouter();

  router.post("/api/v1/shares", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = ShareCreateRequestSchema.parse(req.body);
      const share = await shareService.createShare(actor, input, getAuditContext(req, actor.id));

      res.status(201).json({ data: share });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/resources/:resourceType/:resourceId/shares", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const resourceType = ShareResourceTypeSchema.parse(req.params.resourceType);
      const shares = await shareService.listShares(actor, resourceType, req.params.resourceId);

      res.json({ data: { shares } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/v1/shares/:shareId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const share = await shareService.revokeShare(
        actor,
        req.params.shareId,
        getAuditContext(req, actor.id),
      );

      res.json({ data: share });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
