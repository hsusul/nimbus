import type { Router } from "express";
import { Router as createRouter } from "express";

import { createOpenApiDocument } from "../openapi";

export function openApiRouter(publicApiUrl: string): Router {
  const router = createRouter();
  const document = createOpenApiDocument(publicApiUrl);
  router.get("/api/v1/openapi.json", (_req, res) => {
    res.setHeader("cache-control", "public, max-age=300");
    res.json(document);
  });
  return router;
}
