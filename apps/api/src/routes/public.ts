import { PublicShareQuerySchema } from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { ShareLinkService } from "../services/share-links";
import { getPublicAuditContext } from "./route-context";

export function publicRouter(shareLinkService: ShareLinkService): Router {
  const router = createRouter();

  router.get("/api/v1/public/:token", async (req, res, next) => {
    try {
      const query = PublicShareQuerySchema.parse(req.query);
      const publicShare = await shareLinkService.getPublicShare(
        req.params.token,
        query.download === "true",
        getPublicAuditContext(req),
      );

      res.json({ data: publicShare });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
