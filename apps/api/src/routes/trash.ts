import { CursorPaginationQuerySchema, TrashListResponseSchema } from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { TrashService } from "../services/trash";
import type { UserService } from "../services/users";
import { requireActiveInternalUser } from "./route-context";

export function trashRouter(trashService: TrashService, userService: UserService): Router {
  const router = createRouter();

  router.get("/api/v1/trash", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const query = CursorPaginationQuerySchema.parse(req.query);
      const page = await trashService.listTrash(actor, query);
      res.json(
        TrashListResponseSchema.parse({
          data: { items: page.items, pageInfo: page.pageInfo },
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
