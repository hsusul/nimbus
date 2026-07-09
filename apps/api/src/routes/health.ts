import type { Router } from "express";
import { Router as createRouter } from "express";

export function healthRouter(): Router {
  const router = createRouter();

  router.get("/health", (req, res) => {
    res.json({
      data: {
        status: "ok",
        service: "nimbus-api",
        timestamp: new Date().toISOString(),
        requestId: req.context.requestId,
      },
    });
  });

  return router;
}
