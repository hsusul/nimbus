import { UPLOAD_FINALIZATION_QUEUE_NAME } from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";

import { HttpError } from "../../middleware/error-handler";
import type { AuditContext } from "../audit-log";
import type { UploadFinalizationQueue } from "../queue";
import type { InternalUser } from "../users";
import { assertSessionCanBeQueued, getCorrelationId } from "./helpers";

const MAX_UPLOAD_FINALIZATION_ATTEMPTS = 3;

export interface UploadCompleteResult {
  uploadSessionId: string;
  status: "completing" | "completed";
  fileId: string;
  backgroundJobId: string | null;
  correlationId: string;
}

export async function enqueueSinglePartUploadCompletion(
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
    await markUploadFailed(
      prisma,
      existingSession.id,
      existingSession.targetFileId,
      "upload_session_expired",
    );
    throw new HttpError(410, "upload_session_expired", "Upload session has expired.");
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
          lastError: error instanceof Error ? error.message : String(error),
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

async function markUploadFailed(
  prisma: PrismaClient,
  uploadSessionId: string,
  targetFileId: string | null,
  failureReason: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.uploadSession.update({
      where: {
        id: uploadSessionId,
      },
      data: {
        status: "failed",
        failureReason,
      },
    });

    if (targetFileId) {
      await tx.file.update({
        where: {
          id: targetFileId,
        },
        data: {
          status: "failed",
        },
      });
    }
  });
}
