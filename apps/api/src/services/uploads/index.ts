import type { RegisterUploadChunkRequest, UploadStartRequest } from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import type { AuditContext } from "../audit-log";
import type { UploadFinalizationQueue } from "../queue";
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
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  startUpload(
    actor: InternalUser,
    input: UploadStartRequest,
    auditContext: AuditContext,
  ): Promise<UploadStartResult> {
    return startUpload(actor, input, auditContext, this.storage, this.options, this.prisma);
  }

  getUploadSessionDetail(
    actor: InternalUser,
    uploadSessionId: string,
  ): Promise<UploadSessionDetailResult> {
    return getUploadSessionDetail(actor, uploadSessionId, this.storage, this.options, this.prisma);
  }

  getUploadChunks(actor: InternalUser, uploadSessionId: string): Promise<UploadChunksResult> {
    return getUploadChunks(actor, uploadSessionId, this.prisma);
  }

  registerUploadChunk(
    actor: InternalUser,
    uploadSessionId: string,
    input: RegisterUploadChunkRequest,
  ): Promise<RegisterUploadChunkResult> {
    return registerUploadChunk(actor, uploadSessionId, input, this.prisma);
  }

  completeUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCompleteResult> {
    return enqueueUploadCompletion(
      actor,
      uploadSessionId,
      auditContext,
      this.uploadFinalizationQueue,
      this.prisma,
    );
  }

  cancelUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCancelResult> {
    return cancelUpload(actor, uploadSessionId, auditContext, this.storage, this.prisma);
  }
}
