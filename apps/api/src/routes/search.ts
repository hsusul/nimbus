import { SearchQuerySchema, SearchResponseSchema } from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { SearchService } from "../services/search";
import type { UserService } from "../services/users";
import { requireActiveInternalUser } from "./route-context";

export function searchRouter(searchService: SearchService, userService: UserService): Router {
  const router = createRouter();

  router.get("/api/v1/search", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const query = SearchQuerySchema.parse(req.query);
      const page = await searchService.search(actor, query);

      res.json(
        SearchResponseSchema.parse({
          data: { results: page.items, pageInfo: page.pageInfo },
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}
