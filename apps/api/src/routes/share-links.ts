import { ShareLinkCreateRequestSchema } from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { ShareLinkService } from "../services/share-links";
import type { UserService } from "../services/users";
import { getAuditContext, requireActiveInternalUser } from "./route-context";

export function shareLinksRouter(
  shareLinkService: ShareLinkService,
  userService: UserService,
): Router {
  const router = createRouter();

  router.post("/api/v1/share-links", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = ShareLinkCreateRequestSchema.parse(req.body);
      const shareLink = await shareLinkService.createShareLink(
        actor,
        input,
        getAuditContext(req, actor.id),
      );

      res.status(201).json({ data: shareLink });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/share-links/:shareLinkId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const shareLink = await shareLinkService.getShareLink(actor, req.params.shareLinkId);

      res.json({ data: shareLink });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/v1/share-links/:shareLinkId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const shareLink = await shareLinkService.revokeShareLink(
        actor,
        req.params.shareLinkId,
        getAuditContext(req, actor.id),
      );

      res.json({ data: shareLink });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
