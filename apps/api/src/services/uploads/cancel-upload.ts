import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import { HttpError } from "../../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "../audit-log";
import type { InternalUser } from "../users";
import { getCorrelationId, markUploadExpired } from "./helpers";

export interface UploadCancelResult {
  uploadSessionId: string;
  fileId: string | null;
  status: "canceled";
  abortedMultipartUpload: boolean;
  correlationId: string | null;
}

export async function cancelUpload(
  actor: InternalUser,
  uploadSessionId: string,
  auditContext: AuditContext,
  storage: ObjectStorageProvider,
  prisma: PrismaClient = getPrismaClient(),
): Promise<UploadCancelResult> {
  const session = await prisma.uploadSession.findFirst({
    where: {
      id: uploadSessionId,
      ownerId: actor.id,
    },
  });

  if (!session) {
    throw new HttpError(404, "upload_session_not_found", "Upload session was not found.");
  }

  const correlationId = session.correlationId ?? getCorrelationId(auditContext);

  if (session.status === "canceled") {
    return {
      uploadSessionId: session.id,
      fileId: session.targetFileId,
      status: "canceled",
      abortedMultipartUpload: false,
      correlationId,
    };
  }

  if (["completed", "completing", "failed", "expired"].includes(session.status)) {
    throw new HttpError(409, "upload_not_cancelable", "Upload session cannot be canceled.");
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.$transaction(async (tx) => {
      await markUploadExpired(tx, session.id, session.targetFileId, {
        failTargetFile: session.uploadMode === "new_file",
      });
    });
    throw new HttpError(410, "upload_session_expired", "Upload session has expired.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.uploadSession.update({
      where: {
        id: session.id,
      },
      data: {
        status: "canceled",
        failureReason: "upload_canceled",
        correlationId,
      },
    });

    if (session.targetFileId && session.uploadMode === "new_file") {
      await tx.file.update({
        where: {
          id: session.targetFileId,
        },
        data: {
          status: "failed",
        },
      });
    }

    await appendAuditLog(tx, {
      ...auditContext,
      correlationId,
      action: "upload.canceled",
      resourceType: "upload_session",
      resourceId: session.id,
      metadata: {
        fileId: session.targetFileId,
        uploadType: session.uploadType,
      },
    });
  });

  let abortedMultipartUpload = false;

  if (session.uploadType === "multipart" && session.multipartUploadId) {
    await storage.abortMultipartUpload({
      bucket: session.bucket,
      objectKey: session.finalObjectKey,
      uploadId: session.multipartUploadId,
    });
    abortedMultipartUpload = true;
  }

  return {
    uploadSessionId: session.id,
    fileId: session.targetFileId,
    status: "canceled",
    abortedMultipartUpload,
    correlationId,
  };
}
