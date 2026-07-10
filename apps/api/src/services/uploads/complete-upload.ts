import { UPLOAD_FINALIZATION_QUEUE_NAME } from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";

import { HttpError } from "../../middleware/error-handler";
import type { AuditContext } from "../audit-log";
import type { UploadFinalizationQueue } from "../queue";
import type { InternalUser } from "../users";
import { assertSessionCanBeQueued, getCorrelationId, markUploadExpired } from "./helpers";
import { getMissingPartNumbers } from "./multipart-plan";

const MAX_UPLOAD_FINALIZATION_ATTEMPTS = 3;

export interface UploadCompleteResult {
  uploadSessionId: string;
  status: "completing" | "completed";
  fileId: string;
  backgroundJobId: string | null;
  correlationId: string;
}

export async function enqueueUploadCompletion(
  actor: InternalUser,
  uploadSessionId: string,
  auditContext: AuditContext,
  queue: UploadFinalizationQueue,
  prisma: PrismaClient = getPrismaClient(),
): Promise<UploadCompleteResult> {
  const existingSession = await prisma.uploadSession.findFirst({
    where: {
      id: uploadSessionId,
      ownerId: actor.id,
    },
  });

  if (!existingSession) {
    throw new HttpError(404, "upload_session_not_found", "Upload session was not found.");
  }

  if (!existingSession.targetFileId) {
    throw new HttpError(409, "upload_session_invalid", "Upload session is missing a file target.");
  }

  const correlationId = existingSession.correlationId ?? getCorrelationId(auditContext);

  if (existingSession.status === "completed") {
    const backgroundJob = await findLatestUploadFinalizationJob(prisma, existingSession.id);

    return {
      uploadSessionId: existingSession.id,
      status: "completed",
      fileId: existingSession.targetFileId,
      backgroundJobId: backgroundJob?.id ?? null,
      correlationId,
    };
  }

  if (existingSession.status === "completing") {
    const backgroundJob = await findLatestUploadFinalizationJob(prisma, existingSession.id);

    return {
      uploadSessionId: existingSession.id,
      status: "completing",
      fileId: existingSession.targetFileId,
      backgroundJobId: backgroundJob?.id ?? null,
      correlationId,
    };
  }

  assertSessionCanBeQueued(existingSession.status);

  if (existingSession.expiresAt.getTime() <= Date.now()) {
    await prisma.$transaction(async (tx) => {
      await markUploadExpired(tx, existingSession.id, existingSession.targetFileId, {
        failTargetFile: existingSession.uploadMode === "new_file",
      });
    });
    throw new HttpError(410, "upload_session_expired", "Upload session has expired.");
  }

  if (existingSession.uploadType === "multipart") {
    await assertMultipartUploadComplete(prisma, existingSession);
  }

  const queued = await prisma.$transaction(async (tx) => {
    const session = await tx.uploadSession.update({
      where: {
        id: existingSession.id,
      },
      data: {
        status: "completing",
        correlationId,
        failureReason: null,
      },
    });
    const backgroundJob = await tx.backgroundJob.create({
      data: {
        ownerId: actor.id,
        queueName: UPLOAD_FINALIZATION_QUEUE_NAME,
        resourceType: "upload_session",
        resourceId: session.id,
        status: "queued",
        attempts: 0,
        maxAttempts: MAX_UPLOAD_FINALIZATION_ATTEMPTS,
        correlationId,
      },
    });

    return {
      session,
      backgroundJob,
    };
  });

  try {
    const enqueued = await queue.enqueueUploadFinalization({
      uploadSessionId: queued.session.id,
      backgroundJobId: queued.backgroundJob.id,
      correlationId,
    });

    await prisma.backgroundJob.update({
      where: {
        id: queued.backgroundJob.id,
      },
      data: {
        bullmqJobId: enqueued.bullmqJobId,
      },
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.backgroundJob.update({
        where: {
          id: queued.backgroundJob.id,
        },
        data: {
          status: "failed",
          lastError: "queue_enqueue_failed",
          failureCode: "queue_enqueue_failed",
          completedAt: new Date(),
        },
      });
      await tx.uploadSession.update({
        where: {
          id: queued.session.id,
        },
        data: {
          status: existingSession.status,
        },
      });
    });

    throw error;
  }

  return {
    uploadSessionId: queued.session.id,
    status: "completing",
    fileId: existingSession.targetFileId,
    backgroundJobId: queued.backgroundJob.id,
    correlationId,
  };
}

async function findLatestUploadFinalizationJob(prisma: PrismaClient, uploadSessionId: string) {
  return prisma.backgroundJob.findFirst({
    where: {
      queueName: UPLOAD_FINALIZATION_QUEUE_NAME,
      resourceType: "upload_session",
      resourceId: uploadSessionId,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

async function assertMultipartUploadComplete(
  prisma: PrismaClient,
  uploadSession: {
    id: string;
    totalSizeBytes: bigint;
    chunkSizeBytes: bigint | null;
    multipartUploadId: string | null;
  },
) {
  if (!uploadSession.chunkSizeBytes || !uploadSession.multipartUploadId) {
    throw new HttpError(409, "upload_not_multipart", "Upload session is missing multipart state.");
  }

  const chunks = await prisma.uploadChunk.findMany({
    where: {
      uploadSessionId: uploadSession.id,
      status: {
        in: ["uploaded", "verified"],
      },
    },
    select: {
      partNumber: true,
    },
  });

  const missingPartNumbers = getMissingPartNumbers({
    totalSizeBytes: uploadSession.totalSizeBytes,
    chunkSizeBytes: uploadSession.chunkSizeBytes,
    uploadedPartNumbers: chunks.map((chunk) => chunk.partNumber),
  });

  if (missingPartNumbers.length > 0) {
    throw new HttpError(409, "upload_parts_missing", "Upload is missing registered parts.", {
      missingPartNumbers,
    });
  }
}
