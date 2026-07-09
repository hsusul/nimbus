import {
  UploadFinalizationJobPayloadSchema,
  UPLOAD_FINALIZATION_QUEUE_NAME,
  type UploadFinalizationJobPayload,
} from "@nimbus/contracts";
import { getPrismaClient, Prisma, type PrismaClient } from "@nimbus/db";
import {
  ObjectNotFoundError,
  type ObjectMetadata,
  type ObjectStorageProvider,
} from "@nimbus/storage";

export interface FinalizeUploadDependencies {
  prisma?: PrismaClient;
  storage: ObjectStorageProvider;
}

export async function finalizeUploadSession(
  payload: UploadFinalizationJobPayload,
  dependencies: FinalizeUploadDependencies,
): Promise<void> {
  const parsed = UploadFinalizationJobPayloadSchema.parse(payload);
  const prisma = dependencies.prisma ?? getPrismaClient();

  await markJobRunning(prisma, parsed.backgroundJobId);

  const uploadSession = await prisma.uploadSession.findUnique({
    where: {
      id: parsed.uploadSessionId,
    },
  });

  if (!uploadSession) {
    await markJobFailed(prisma, parsed.backgroundJobId, "upload_session_not_found");
    return;
  }

  const correlationId =
    uploadSession.correlationId ?? parsed.correlationId ?? `job:${parsed.backgroundJobId}`;

  if (uploadSession.status === "completed") {
    await markJobSucceeded(prisma, parsed.backgroundJobId, correlationId);
    return;
  }

  if (["failed", "canceled", "expired"].includes(uploadSession.status)) {
    await markJobFailed(
      prisma,
      parsed.backgroundJobId,
      `upload_${uploadSession.status}`,
      correlationId,
    );
    return;
  }

  if (uploadSession.status !== "completing") {
    await markJobFailed(
      prisma,
      parsed.backgroundJobId,
      `upload_not_ready:${uploadSession.status}`,
      correlationId,
    );
    return;
  }

  if (!uploadSession.targetFileId) {
    await failUploadTerminal(
      prisma,
      parsed.backgroundJobId,
      uploadSession.id,
      null,
      "missing_target_file",
      correlationId,
    );
    return;
  }

  let objectMetadata: ObjectMetadata;

  try {
    objectMetadata = await dependencies.storage.headObject({
      bucket: uploadSession.bucket,
      objectKey: uploadSession.finalObjectKey,
    });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      await failUploadTerminal(
        prisma,
        parsed.backgroundJobId,
        uploadSession.id,
        uploadSession.targetFileId,
        "object_missing",
        correlationId,
      );
      return;
    }

    throw error;
  }

  const metadataSha256 = getHeadSha256(objectMetadata);

  if (objectMetadata.sizeBytes !== uploadSession.totalSizeBytes) {
    await failUploadTerminal(
      prisma,
      parsed.backgroundJobId,
      uploadSession.id,
      uploadSession.targetFileId,
      "size_mismatch",
      correlationId,
    );
    return;
  }

  if (
    uploadSession.expectedSha256 &&
    metadataSha256 &&
    uploadSession.expectedSha256 !== metadataSha256
  ) {
    await failUploadTerminal(
      prisma,
      parsed.backgroundJobId,
      uploadSession.id,
      uploadSession.targetFileId,
      "sha256_mismatch",
      correlationId,
    );
    return;
  }

  await prisma.$transaction(async (tx) => {
    const lockedSession = await tx.uploadSession.findUnique({
      where: {
        id: uploadSession.id,
      },
    });

    if (!lockedSession) {
      throw new Error("upload_session_not_found");
    }

    if (lockedSession.status === "completed") {
      await tx.backgroundJob.update({
        where: {
          id: parsed.backgroundJobId,
        },
        data: {
          status: "succeeded",
          lastError: null,
          correlationId,
          completedAt: new Date(),
        },
      });
      return;
    }

    if (lockedSession.status !== "completing") {
      await tx.backgroundJob.update({
        where: {
          id: parsed.backgroundJobId,
        },
        data: {
          status: "failed",
          lastError: `upload_not_ready:${lockedSession.status}`,
          correlationId,
          completedAt: new Date(),
        },
      });
      return;
    }

    if (!lockedSession.targetFileId) {
      throw new Error("missing_target_file");
    }

    const existingVersion = await tx.fileVersion.findUnique({
      where: {
        uploadSessionId: lockedSession.id,
      },
    });

    if (existingVersion) {
      await tx.file.update({
        where: {
          id: lockedSession.targetFileId,
        },
        data: {
          status: "active",
          currentVersionId: existingVersion.id,
          sizeBytes: existingVersion.sizeBytes,
          contentHash: existingVersion.sha256,
          mimeType: existingVersion.mimeType,
        },
      });
      await tx.uploadSession.update({
        where: {
          id: lockedSession.id,
        },
        data: {
          status: "completed",
          completedAt: lockedSession.completedAt ?? new Date(),
          failureReason: null,
          correlationId,
        },
      });
      await tx.backgroundJob.update({
        where: {
          id: parsed.backgroundJobId,
        },
        data: {
          status: "succeeded",
          lastError: null,
          correlationId,
          completedAt: new Date(),
        },
      });
      return;
    }

    const versionNumber = await getNextVersionNumber(tx, lockedSession.targetFileId);
    const fileVersion = await tx.fileVersion.create({
      data: {
        id: lockedSession.plannedVersionId,
        fileId: lockedSession.targetFileId,
        versionNumber,
        storageProvider: "s3-compatible",
        bucket: lockedSession.bucket,
        objectKey: lockedSession.finalObjectKey,
        sizeBytes: objectMetadata.sizeBytes,
        sha256: lockedSession.expectedSha256 ?? metadataSha256,
        etag: objectMetadata.etag,
        mimeType: lockedSession.mimeType,
        uploadSessionId: lockedSession.id,
        createdById: lockedSession.ownerId,
        processingStatus: "available",
      },
    });
    const file = await tx.file.update({
      where: {
        id: lockedSession.targetFileId,
      },
      data: {
        status: "active",
        currentVersionId: fileVersion.id,
        sizeBytes: objectMetadata.sizeBytes,
        contentHash: fileVersion.sha256,
        mimeType: lockedSession.mimeType,
      },
    });

    await tx.uploadSession.update({
      where: {
        id: lockedSession.id,
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        failureReason: null,
        correlationId,
      },
    });
    await tx.backgroundJob.update({
      where: {
        id: parsed.backgroundJobId,
      },
      data: {
        status: "succeeded",
        lastError: null,
        correlationId,
        completedAt: new Date(),
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: lockedSession.ownerId,
        action: "upload.completed",
        resourceType: "file",
        resourceId: file.id,
        requestId: correlationId,
        correlationId,
        metadataJson: {
          uploadSessionId: lockedSession.id,
          backgroundJobId: parsed.backgroundJobId,
          fileVersionId: fileVersion.id,
          sizeBytes: fileVersion.sizeBytes.toString(),
        },
      },
    });
  });
}

export async function markUploadFinalizationJobDeadLettered(
  backgroundJobId: string,
  error: unknown,
  prisma: PrismaClient = getPrismaClient(),
) {
  await prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      status: "dead_lettered",
      lastError: error instanceof Error ? error.message : String(error),
      completedAt: new Date(),
    },
  });
}

async function markJobRunning(prisma: PrismaClient, backgroundJobId: string) {
  await prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      status: "running",
      attempts: {
        increment: 1,
      },
    },
  });
}

async function markJobSucceeded(
  prisma: PrismaClient,
  backgroundJobId: string,
  correlationId?: string | null,
) {
  await prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      status: "succeeded",
      lastError: null,
      correlationId,
      completedAt: new Date(),
    },
  });
}

async function markJobFailed(
  prisma: PrismaClient,
  backgroundJobId: string,
  lastError: string,
  correlationId?: string | null,
) {
  await prisma.backgroundJob.update({
    where: {
      id: backgroundJobId,
    },
    data: {
      status: "failed",
      lastError,
      correlationId,
      completedAt: new Date(),
    },
  });
}

async function failUploadTerminal(
  prisma: PrismaClient,
  backgroundJobId: string,
  uploadSessionId: string,
  targetFileId: string | null,
  failureReason: string,
  correlationId: string,
) {
  await prisma.$transaction(async (tx) => {
    await tx.uploadSession.update({
      where: {
        id: uploadSessionId,
      },
      data: {
        status: "failed",
        failureReason,
        correlationId,
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

    await tx.backgroundJob.update({
      where: {
        id: backgroundJobId,
      },
      data: {
        status: "failed",
        lastError: failureReason,
        correlationId,
        completedAt: new Date(),
      },
    });
  });
}

async function getNextVersionNumber(tx: Prisma.TransactionClient, fileId: string): Promise<number> {
  const latestVersion = await tx.fileVersion.findFirst({
    where: {
      fileId,
    },
    orderBy: {
      versionNumber: "desc",
    },
  });

  return (latestVersion?.versionNumber ?? 0) + 1;
}

function getHeadSha256(metadata: ObjectMetadata): string | null {
  return metadata.metadata["sha256"] ?? metadata.metadata["nimbus-sha256"] ?? null;
}

export { UPLOAD_FINALIZATION_QUEUE_NAME };
