import {
  OBJECT_CLEANUP_QUEUE_NAME,
  ObjectCleanupJobPayloadSchema,
  type ObjectCleanupJobPayload,
} from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import { ObjectNotFoundError, type ObjectStorageProvider } from "@nimbus/storage";

import { markDurableJobFailed, markDurableJobRunning, markDurableJobSucceeded } from "./job-state";

export { OBJECT_CLEANUP_QUEUE_NAME };

const CLEANABLE_UPLOAD_STATUSES = ["expired", "failed", "canceled"];
const LIVE_UPLOAD_STATUSES = ["created", "uploading", "completing"];

export async function cleanupUploadArtifacts(
  payload: ObjectCleanupJobPayload,
  dependencies: { storage: ObjectStorageProvider; prisma?: PrismaClient },
): Promise<void> {
  const parsed = ObjectCleanupJobPayloadSchema.parse(payload);
  const prisma = dependencies.prisma ?? getPrismaClient();
  const job = await markDurableJobRunning(parsed.backgroundJobId, prisma);

  if (
    job.queueName !== OBJECT_CLEANUP_QUEUE_NAME ||
    job.resourceType !== "upload_session" ||
    job.resourceId !== parsed.uploadSessionId
  ) {
    await markDurableJobFailed(job.id, "job_payload_mismatch", prisma);
    return;
  }

  const session = await prisma.uploadSession.findUnique({
    where: { id: parsed.uploadSessionId },
  });

  if (!session) {
    await markDurableJobSucceeded(job.id, prisma);
    return;
  }
  if (session.ownerId !== job.ownerId) {
    await markDurableJobFailed(job.id, "job_owner_mismatch", prisma);
    return;
  }
  if (!CLEANABLE_UPLOAD_STATUSES.includes(session.status)) {
    await markDurableJobSucceeded(job.id, prisma);
    return;
  }

  const [referencedVersion, liveSession, activeThumbnail] = await Promise.all([
    prisma.fileVersion.findFirst({
      where: {
        OR: [
          { uploadSessionId: session.id, processingStatus: "available" },
          {
            bucket: session.bucket,
            objectKey: session.finalObjectKey,
            processingStatus: "available",
          },
          {
            bucket: session.bucket,
            objectKey: session.finalObjectKey,
            currentForFiles: { some: {} },
          },
        ],
      },
      select: { id: true },
    }),
    prisma.uploadSession.findFirst({
      where: {
        id: { not: session.id },
        bucket: session.bucket,
        finalObjectKey: session.finalObjectKey,
        status: { in: LIVE_UPLOAD_STATUSES },
      },
      select: { id: true },
    }),
    prisma.thumbnail.findFirst({
      where: {
        bucket: session.bucket,
        objectKey: session.finalObjectKey,
        status: { in: ["pending", "processing", "complete"] },
      },
      select: { id: true },
    }),
  ]);

  if (referencedVersion || liveSession || activeThumbnail) {
    await markDurableJobSucceeded(job.id, prisma);
    return;
  }

  try {
    if (session.uploadType === "multipart" && session.multipartUploadId) {
      try {
        await dependencies.storage.abortMultipartUpload({
          bucket: session.bucket,
          objectKey: session.finalObjectKey,
          uploadId: session.multipartUploadId,
        });
      } catch (error) {
        if (!isAlreadyAbsentMultipartError(error)) throw error;
      }
    }

    try {
      await dependencies.storage.deleteObject({
        bucket: session.bucket,
        objectKey: session.finalObjectKey,
      });
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }

    await markDurableJobSucceeded(job.id, prisma);
  } catch (error) {
    await markDurableJobFailed(job.id, "object_cleanup_storage_failed", prisma);
    throw error;
  }
}

function isAlreadyAbsentMultipartError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  return [name, message].some((value) =>
    ["NoSuchUpload", "NotFound", "multipart_upload_not_found"].includes(value),
  );
}
