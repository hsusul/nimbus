import type { UploadStartRequest } from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import type { AuditContext } from "../audit-log";
import type { UploadFinalizationQueue } from "../queue";
import type { InternalUser } from "../users";
import { enqueueSinglePartUploadCompletion, type UploadCompleteResult } from "./complete-upload";
import {
  startSinglePartUpload,
  type UploadServiceOptions,
  type UploadStartResult,
} from "./start-upload";

export type { UploadCompleteResult, UploadServiceOptions, UploadStartResult };

export interface UploadService {
  startSinglePartUpload(
    actor: InternalUser,
    input: UploadStartRequest,
    auditContext: AuditContext,
  ): Promise<UploadStartResult>;
  completeSinglePartUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCompleteResult>;
}

export class PrismaUploadService implements UploadService {
  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly uploadFinalizationQueue: UploadFinalizationQueue,
    private readonly options: UploadServiceOptions,
    private readonly prisma: PrismaClient = getPrismaClient(),
  ) {}

  startSinglePartUpload(
    actor: InternalUser,
    input: UploadStartRequest,
    auditContext: AuditContext,
  ): Promise<UploadStartResult> {
    return startSinglePartUpload(
      actor,
      input,
      auditContext,
      this.storage,
      this.options,
      this.prisma,
    );
  }

  completeSinglePartUpload(
    actor: InternalUser,
    uploadSessionId: string,
    auditContext: AuditContext,
  ): Promise<UploadCompleteResult> {
    return enqueueSinglePartUploadCompletion(
      actor,
      uploadSessionId,
      auditContext,
      this.uploadFinalizationQueue,
      this.prisma,
    );
  }
}
