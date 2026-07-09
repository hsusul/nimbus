import {
  CursorPaginationQuerySchema,
  FileCreateRequestSchema,
  FileMoveRequestSchema,
  FileUpdateRequestSchema,
} from "@nimbus/contracts";
import type { Router } from "express";
import { Router as createRouter } from "express";
import { z } from "zod";

import type { FileService } from "../services/files";
import type { UserService } from "../services/users";
import { getAuditContext, requireActiveInternalUser } from "./route-context";

const FileListQuerySchema = CursorPaginationQuerySchema.extend({
  folderId: z.string().min(1).optional(),
});

export function filesRouter(fileService: FileService, userService: UserService): Router {
  const router = createRouter();

  router.get("/api/v1/files", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const query = FileListQuerySchema.parse(req.query);
      const page = await fileService.listFiles(actor, query.folderId ?? actor.rootFolderId, query);

      res.json({
        data: {
          files: page.items,
          pageInfo: page.pageInfo,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/files/:fileId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const file = await fileService.getFile(actor, req.params.fileId);

      res.json({
        data: file,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/files", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = FileCreateRequestSchema.parse(req.body);
      const file = await fileService.createFile(actor, input, getAuditContext(req, actor.id));

      res.status(201).json({
        data: file,
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/v1/files/:fileId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = FileUpdateRequestSchema.parse(req.body);
      const file = await fileService.updateFile(
        actor,
        req.params.fileId,
        input,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: file,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/files/:fileId/move", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const input = FileMoveRequestSchema.parse(req.body);
      const file = await fileService.moveFile(
        actor,
        req.params.fileId,
        input,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: file,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/api/v1/files/:fileId", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const file = await fileService.deleteFile(
        actor,
        req.params.fileId,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: file,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/files/:fileId/restore", async (req, res, next) => {
    try {
      const actor = await requireActiveInternalUser(req, userService);
      const file = await fileService.restoreFile(
        actor,
        req.params.fileId,
        getAuditContext(req, actor.id),
      );

      res.json({
        data: file,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
