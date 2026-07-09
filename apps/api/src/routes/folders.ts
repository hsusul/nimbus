import {
  CursorPaginationQuerySchema,
  FolderCreateRequestSchema,
  FolderMoveRequestSchema,
  FolderUpdateRequestSchema,
} from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";

import type { FolderService } from "../services/folders";
import type { UserService } from "../services/users";
import { getAuditContext, requireActiveInternalUser } from "./route-context";

export function foldersRouter(folderService: FolderService, userService: UserService): Router {
  const router = createRouter();

  router.post("/api/v1/folders", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = FolderCreateRequestSchema.parse(req.body);
      const folder = await folderService.createFolder(actor, input, getAuditContext(req, actor.id));

      res.status(201).json({
        data: folder,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/folders/:folderId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const folder = await folderService.getFolder(actor, req.params.folderId);

      res.json({
        data: folder,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/folders/:folderId/children", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const pagination = CursorPaginationQuerySchema.parse(req.query);
      const page = await folderService.listChildren(actor, req.params.folderId, pagination);

      res.json({
        data: {
          folderId: page.folderId,
          children: page.items,
          pageInfo: page.pageInfo,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/v1/folders/:folderId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = FolderUpdateRequestSchema.parse(req.body);
      const folder = await folderService.updateFolder(
        actor,
        req.params.folderId,
        input,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: folder,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/folders/:folderId/move", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = FolderMoveRequestSchema.parse(req.body);
      const folder = await folderService.moveFolder(
        actor,
        req.params.folderId,
        input,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: folder,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/v1/folders/:folderId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const folder = await folderService.deleteFolder(
        actor,
        req.params.folderId,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: folder,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/folders/:folderId/restore", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const folder = await folderService.restoreFolder(
        actor,
        req.params.folderId,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: folder,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
