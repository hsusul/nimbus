import {
  ApiKeyCreateRequestSchema,
  ApiKeyCreateResponseSchema,
  ApiKeyListResponseSchema,
  ApiKeyResponseSchema,
} from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { ApiKeyService } from "../services/api-keys";
import type { UserService } from "../services/users";
import { getAuditContext, requireActiveInternalUser } from "./route-context";

export function apiKeysRouter(service: ApiKeyService, userService: UserService): Router {
  const router = createRouter();
  router.post("/api/v1/api-keys", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = ApiKeyCreateRequestSchema.parse(req.body);
      const created = await service.create(actor, input, getAuditContext(req, actor.id));
      res.status(201).json(
        ApiKeyCreateResponseSchema.parse({
          data: { ...created, warning: "Store this key securely. It will not be shown again." },
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  router.get("/api/v1/api-keys", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      res.json(ApiKeyListResponseSchema.parse({ data: { apiKeys: await service.list(actor.id) } }));
    } catch (e) {
      next(e);
    }
  });
  router.get("/api/v1/api-keys/:apiKeyId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      res.json(
        ApiKeyResponseSchema.parse({ data: await service.get(actor.id, req.params.apiKeyId) }),
      );
    } catch (e) {
      next(e);
    }
  });
  router.delete("/api/v1/api-keys/:apiKeyId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      res.json(
        ApiKeyResponseSchema.parse({
          data: await service.revoke(actor.id, req.params.apiKeyId, getAuditContext(req, actor.id)),
        }),
      );
    } catch (e) {
      next(e);
    }
  });
  return router;
}
