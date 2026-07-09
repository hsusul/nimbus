import { UploadStartRequestSchema } from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { UploadService } from "../services/uploads";
import type { UserService } from "../services/users";
import { getAuditContext, requireActiveInternalUser } from "./route-context";

export function uploadsRouter(uploadService: UploadService, userService: UserService): Router {
  const router = createRouter();

  router.post("/api/v1/uploads/start", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = UploadStartRequestSchema.parse(req.body);
      const upload = await uploadService.startSinglePartUpload(
        actor,
        input,
        getAuditContext(req, actor.id),
      );

      res.status(201).json({
        data: upload,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/uploads/:uploadSessionId/complete", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const file = await uploadService.completeSinglePartUpload(
        actor,
        req.params.uploadSessionId,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: {
          file,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
