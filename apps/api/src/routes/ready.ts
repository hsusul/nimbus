import type { Router } from "express";
import { Router as createRouter } from "express";

import type { ReadinessChecker } from "../services/readiness";

export function readyRouter(readinessChecker: ReadinessChecker): Router {
  const router = createRouter();

  router.get("/ready", async (req, res, next) => {
    try {
      const dependencies = await readinessChecker();
      const ready = dependencies.postgres && dependencies.redis;

      res.status(ready ? 200 : 503).json({
        data: {
          status: ready ? "ready" : "not_ready",
          service: "nimbus-api",
          timestamp: new Date().toISOString(),
          requestId: req.context.requestId,
          dependencies,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
