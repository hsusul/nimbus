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
  const failTargetFile = uploadSession.uploadMode === "new_file";

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
      {
        failTargetFile: false,
      },
    );
    return;
  }

  const existingVersion = await prisma.fileVersion.findUnique({
    where: {
      uploadSessionId: uploadSession.id,
    },
  });

  if (existingVersion) {
    await completeWithExistingVersion(
      prisma,
      parsed.backgroundJobId,
      uploadSession.id,
      uploadSession.targetFileId,
      existingVersion.id,
      correlationId,
      uploadSession.uploadMode,
    );
    return;
  }

  if (uploadSession.uploadType === "multipart") {
    const completed = await completeMultipartUploadForSession(
      prisma,
      dependencies.storage,
      uploadSession,
    );

    if (!completed.ok) {
      await failUploadTerminal(
        prisma,
        parsed.backgroundJobId,
        uploadSession.id,
        uploadSession.targetFileId,
        completed.failureReason,
        correlationId,
        {
          failTargetFile,
        },
      );
      return;
    }
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
        {
          failTargetFile,
        },
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
      {
        failTargetFile,
      },
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
      {
        failTargetFile,
      },
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

    const targetFile = await lockAndGetTargetFile(tx, lockedSession.targetFileId);

    if (!targetFile) {
      await markUploadAndJobFailed(
        tx,
        parsed.backgroundJobId,
        lockedSession.id,
        "target_file_not_found",
        correlationId,
      );
      return;
    }

    if (
      lockedSession.uploadMode === "new_version" &&
      (targetFile.status !== "active" || targetFile.deletedAt)
    ) {
      await markUploadAndJobFailed(
        tx,
        parsed.backgroundJobId,
        lockedSession.id,
        "target_file_not_available",
        correlationId,
      );
      return;
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
        action:
          lockedSession.uploadMode === "new_version" ? "file.version_uploaded" : "upload.completed",
        resourceType: "file",
        resourceId: file.id,
        requestId: correlationId,
        correlationId,
        metadataJson: {
          uploadSessionId: lockedSession.id,
          backgroundJobId: parsed.backgroundJobId,
          fileVersionId: fileVersion.id,
          uploadMode: lockedSession.uploadMode,
          versionNumber: fileVersion.versionNumber,
          sizeBytes: fileVersion.sizeBytes.toString(),
        },
      },
    });
  });
}

async function completeMultipartUploadForSession(
  prisma: PrismaClient,
  storage: ObjectStorageProvider,
  uploadSession: {
    id: string;
    bucket: string;
    finalObjectKey: string;
    multipartUploadId: string | null;
    totalSizeBytes: bigint;
    chunkSizeBytes: bigint | null;
  },
): Promise<{ ok: true } | { ok: false; failureReason: string }> {
  if (!uploadSession.multipartUploadId || !uploadSession.chunkSizeBytes) {
    return {
      ok: false,
      failureReason: "missing_multipart_state",
    };
  }

  const chunks = await prisma.uploadChunk.findMany({
    where: {
      uploadSessionId: uploadSession.id,
      status: {
        in: ["uploaded", "verified"],
      },
    },
    orderBy: {
      partNumber: "asc",
    },
  });
  const missingPartNumbers = getMissingPartNumbers({
    totalSizeBytes: uploadSession.totalSizeBytes,
    chunkSizeBytes: uploadSession.chunkSizeBytes,
    uploadedPartNumbers: chunks.map((chunk) => chunk.partNumber),
  });

  if (missingPartNumbers.length > 0) {
    return {
      ok: false,
      failureReason: "multipart_parts_missing",
    };
  }

  await storage.completeMultipartUpload({
    bucket: uploadSession.bucket,
    objectKey: uploadSession.finalObjectKey,
    uploadId: uploadSession.multipartUploadId,
    parts: chunks.map((chunk) => ({
      partNumber: chunk.partNumber,
      etag: chunk.etag,
    })),
  });

  return {
    ok: true,
  };
}

async function completeWithExistingVersion(
  prisma: PrismaClient,
  backgroundJobId: string,
  uploadSessionId: string,
  targetFileId: string,
  fileVersionId: string,
  correlationId: string,
  uploadMode: string,
) {
  await prisma.$transaction(async (tx) => {
    const targetFile = await lockAndGetTargetFile(tx, targetFileId);

    if (!targetFile) {
      await markUploadAndJobFailed(
        tx,
        backgroundJobId,
        uploadSessionId,
        "target_file_not_found",
        correlationId,
      );
      return;
    }

    if (uploadMode === "new_version" && (targetFile.status !== "active" || targetFile.deletedAt)) {
      await markUploadAndJobFailed(
        tx,
        backgroundJobId,
        uploadSessionId,
        "target_file_not_available",
        correlationId,
      );
      return;
    }

    const fileVersion = await tx.fileVersion.findUniqueOrThrow({
      where: {
        id: fileVersionId,
      },
    });

    await tx.file.update({
      where: {
        id: targetFileId,
      },
      data: {
        status: "active",
        currentVersionId: fileVersion.id,
        sizeBytes: fileVersion.sizeBytes,
        contentHash: fileVersion.sha256,
        mimeType: fileVersion.mimeType,
      },
    });
    await tx.uploadSession.update({
      where: {
        id: uploadSessionId,
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
        id: backgroundJobId,
      },
      data: {
        status: "succeeded",
        lastError: null,
        correlationId,
        completedAt: new Date(),
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
  options: { failTargetFile?: boolean } = {},
) {
  const failTargetFile = options.failTargetFile ?? true;

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

    if (targetFileId && failTargetFile) {
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

async function markUploadAndJobFailed(
  tx: Prisma.TransactionClient,
  backgroundJobId: string,
  uploadSessionId: string,
  failureReason: string,
  correlationId: string,
) {
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
}

async function lockAndGetTargetFile(tx: Prisma.TransactionClient, fileId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT id FROM "files" WHERE id = ${fileId} FOR UPDATE`,
  );

  if (rows.length === 0) {
    return null;
  }

  return tx.file.findUnique({
    where: {
      id: fileId,
    },
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

function getMissingPartNumbers(input: {
  totalSizeBytes: bigint;
  chunkSizeBytes: bigint;
  uploadedPartNumbers: number[];
}): number[] {
  const partCount = calculatePartCount(input.totalSizeBytes, input.chunkSizeBytes);
  const uploaded = new Set(input.uploadedPartNumbers);
  const missing: number[] = [];

  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    if (!uploaded.has(partNumber)) {
      missing.push(partNumber);
    }
  }

  return missing;
}

function calculatePartCount(totalSizeBytes: bigint, chunkSizeBytes: bigint): number {
  if (chunkSizeBytes <= 0n) {
    throw new Error("chunk_size_must_be_positive");
  }

  if (totalSizeBytes <= 0n) {
    return 1;
  }

  return Number((totalSizeBytes + chunkSizeBytes - 1n) / chunkSizeBytes);
}

export { UPLOAD_FINALIZATION_QUEUE_NAME };
