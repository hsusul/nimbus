import { Prisma, type PrismaClient } from "@nimbus/db";

import { HttpError } from "../../middleware/error-handler";

export type TransactionClient = Prisma.TransactionClient;

export async function getActiveFolder(
  tx: PrismaClient | TransactionClient,
  ownerId: string,
  folderId: string,
) {
  const folder = await tx.folder.findFirst({
    where: {
      id: folderId,
      ownerId,
      deletedAt: null,
    },
  });

  if (!folder) {
    throw new HttpError(404, "folder_not_found", "Folder was not found.");
  }

  return folder;
}

export async function assertFileNameAvailable(
  tx: TransactionClient,
  ownerId: string,
  folderId: string,
  normalizedName: string,
) {
  const existingFile = await tx.file.findFirst({
    where: {
      ownerId,
      folderId,
      normalizedName,
      status: {
        in: ["active", "uploading"],
      },
      deletedAt: null,
    },
  });

  if (existingFile) {
    throw new HttpError(409, "duplicate_file_name", "File name already exists in this folder.");
  }
}

export function parseSizeBytes(value: string | number): bigint {
  const sizeBytes = BigInt(value);

  if (sizeBytes < 0n) {
    throw new HttpError(400, "invalid_size_bytes", "totalSizeBytes must be non-negative.");
  }

  return sizeBytes;
}

export function getCorrelationId(input: { correlationId?: string | null; requestId: string }) {
  return input.correlationId ?? input.requestId;
}

export function assertSessionCanBeQueued(status: string) {
  if (["failed", "canceled", "expired"].includes(status)) {
    throw new HttpError(409, "upload_not_completable", "Upload session cannot be completed.");
  }
}

export function isTerminalUploadStatus(status: string) {
  return ["completed", "failed", "canceled", "expired"].includes(status);
}

export async function markUploadExpired(
  tx: TransactionClient,
  uploadSessionId: string,
  targetFileId: string | null,
) {
  await tx.uploadSession.update({
    where: {
      id: uploadSessionId,
    },
    data: {
      status: "expired",
      failureReason: "upload_session_expired",
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
}
