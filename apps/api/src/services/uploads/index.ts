import type { RegisterUploadChunkRequest, UploadStartRequest } from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import { HttpError } from "../../middleware/error-handler";
import type { AuditContext } from "../audit-log";
import type { UploadFinalizationQueue } from "../queue";
import type { PermissionService } from "../permission-service";
import type { InternalUser } from "../users";
import { cancelUpload, type UploadCancelResult } from "./cancel-upload";
import { registerUploadChunk, type RegisterUploadChunkResult } from "./chunks";
import { enqueueUploadCompletion, type UploadCompleteResult } from "./complete-upload";
import { startUpload, type UploadServiceOptions, type UploadStartResult } from "./start-upload";
import {
  getUploadChunks,
  getUploadSessionDetail,
  type UploadChunksResult,
  type UploadSessionDetailResult,
} from "./status";

export type {
  RegisterUploadChunkResult,
  UploadCancelResult,
  UploadChunksResult,
  UploadCompleteResult,
  UploadServiceOptions,
  UploadSessionDetailResult,
  UploadStartResult,
};

export interface UploadService {
  startUpload(
    actor: InternalUser,
    input: UploadStartRequest,
    auditContext: AuditContext,
  ): Promise<UploadStartResult>;
  getUploadSessionDetail(
    actor: InternalUser,
    uploadSessionId: string,
  ): Promise<UploadSessionDetailResult>;
  getUploadChunks(actor: InternalUser, uploadSessionId: string): Promise<UploadChunksResult>;
  registerUploadChunk(
    actor: InternalUser,
    uploadSessionId: string,
    input: RegisterUploadChunkRequest,
  ): Promise<RegisterUploadChunkResult>;
  completeUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCompleteResult>;
  cancelUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCancelResult>;
}

export class PrismaUploadService implements UploadService {
  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly uploadFinalizationQueue: UploadFinalizationQueue,
    private readonly options: UploadServiceOptions,
    private readonly permissionService: PermissionService,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  startUpload(
    actor: InternalUser,
    input: UploadStartRequest,
    auditContext: AuditContext,
  ): Promise<UploadStartResult> {
    return startUpload(
      actor,
      input,
      auditContext,
      this.storage,
      this.options,
      this.permissionService,
      this.prisma,
    );
  }

  async getUploadSessionDetail(
    actor: InternalUser,
    uploadSessionId: string,
  ): Promise<UploadSessionDetailResult> {
    await requireCurrentUploadPermission(
      actor,
      uploadSessionId,
      this.permissionService,
      this.prisma,
    );
    return getUploadSessionDetail(actor, uploadSessionId, this.storage, this.options, this.prisma);
  }

  async getUploadChunks(actor: InternalUser, uploadSessionId: string): Promise<UploadChunksResult> {
    await requireCurrentUploadPermission(
      actor,
      uploadSessionId,
      this.permissionService,
      this.prisma,
    );
    return getUploadChunks(actor, uploadSessionId, this.prisma);
  }

  async registerUploadChunk(
    actor: InternalUser,
    uploadSessionId: string,
    input: RegisterUploadChunkRequest,
  ): Promise<RegisterUploadChunkResult> {
    await requireCurrentUploadPermission(
      actor,
      uploadSessionId,
      this.permissionService,
      this.prisma,
    );
    return registerUploadChunk(actor, uploadSessionId, input, this.prisma);
  }

  async completeUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCompleteResult> {
    await requireCurrentUploadPermission(
      actor,
      uploadSessionId,
      this.permissionService,
      this.prisma,
    );
    return enqueueUploadCompletion(
      actor,
      uploadSessionId,
      auditContext,
      this.uploadFinalizationQueue,
      this.prisma,
    );
  }

  async cancelUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCancelResult> {
    await requireCurrentUploadPermission(
      actor,
      uploadSessionId,
      this.permissionService,
      this.prisma,
    );
    return cancelUpload(actor, uploadSessionId, auditContext, this.storage, this.prisma);
  }
}

async function requireCurrentUploadPermission(
  actor: InternalUser,
  uploadSessionId: string,
  permissionService: PermissionService,
  prisma: PrismaClient,
): Promise<void> {
  const session = await prisma.uploadSession.findFirst({
    where: {
      id: uploadSessionId,
      ownerId: actor.id,
    },
    select: {
      uploadMode: true,
      targetFileId: true,
    },
  });

  if (!session) {
    throw new HttpError(404, "upload_session_not_found", "Upload session was not found.");
  }

  if (session.uploadMode !== "new_version") {
    return;
  }

  if (!session.targetFileId) {
    throw new HttpError(409, "upload_session_invalid", "Upload session is missing a file target.");
  }

  await permissionService.require(actor, "file.write", {
    resourceType: "file",
    resourceId: session.targetFileId,
  });
}
