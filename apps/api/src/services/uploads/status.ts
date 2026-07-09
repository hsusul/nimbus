import {
  getPrismaClient,
  type PrismaClient,
  type UploadChunk,
  type UploadSession,
} from "@nimbus/db";
import type { ObjectStorageProvider } from "@nimbus/storage";

import { HttpError } from "../../middleware/error-handler";
import type { InternalUser } from "../users";
import { markUploadExpired } from "./helpers";
import { calculatePartCount, getExpectedPartSize, getMissingPartNumbers } from "./multipart-plan";
import type { UploadServiceOptions } from "./start-upload";

export interface UploadChunkDto {
  id: string;
  partNumber: number;
  sizeBytes: string;
  sha256: string | null;
  etag: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignedPartUploadDto {
  partNumber: number;
  sizeBytes: string;
  url: string;
  method: "PUT";
  expiresAt: string;
  headers: Record<string, string>;
}

export interface UploadSessionDetailResult {
  uploadSessionId: string;
  fileId: string | null;
  status: string;
  uploadType: "single_part" | "multipart";
  totalSizeBytes: string;
  receivedBytes: string;
  chunkSizeBytes: string | null;
  partCount: number;
  uploadedParts: UploadChunkDto[];
  missingPartNumbers: number[];
  correlationId: string | null;
  expiresAt: string;
  signedParts?: SignedPartUploadDto[];
}

export interface UploadChunksResult {
  uploadSessionId: string;
  uploadedParts: UploadChunkDto[];
  missingPartNumbers: number[];
}

export async function getUploadSessionDetail(
  actor: InternalUser,
  uploadSessionId: string,
  storage: ObjectStorageProvider,
  options: UploadServiceOptions,
  prisma: PrismaClient = getPrismaClient(),
): Promise<UploadSessionDetailResult> {
  const { session, chunks } = await loadOwnedUploadSession(actor, uploadSessionId, prisma);
  const currentSession = await expireSessionIfNeeded(session, prisma);
  const detail = buildUploadSessionDetail(currentSession, chunks);

  if (
    currentSession.uploadType === "multipart" &&
    ["created", "uploading"].includes(currentSession.status)
  ) {
    detail.signedParts = await signPartsForSession(
      currentSession,
      detail.missingPartNumbers,
      storage,
      options,
    );
  }

  return detail;
}

export async function getUploadChunks(
  actor: InternalUser,
  uploadSessionId: string,
  prisma: PrismaClient = getPrismaClient(),
): Promise<UploadChunksResult> {
  const { session, chunks } = await loadOwnedUploadSession(actor, uploadSessionId, prisma);
  const currentSession = await expireSessionIfNeeded(session, prisma);
  const detail = buildUploadSessionDetail(currentSession, chunks);

  return {
    uploadSessionId: detail.uploadSessionId,
    uploadedParts: detail.uploadedParts,
    missingPartNumbers: detail.missingPartNumbers,
  };
}

export async function loadOwnedUploadSession(
  actor: InternalUser,
  uploadSessionId: string,
  prisma: PrismaClient,
): Promise<{ session: UploadSession; chunks: UploadChunk[] }> {
  const session = await prisma.uploadSession.findFirst({
    where: {
      id: uploadSessionId,
      ownerId: actor.id,
    },
    include: {
      uploadChunks: {
        orderBy: {
          partNumber: "asc",
        },
      },
    },
  });

  if (!session) {
    throw new HttpError(404, "upload_session_not_found", "Upload session was not found.");
  }

  return {
    session,
    chunks: session.uploadChunks,
  };
}

export function buildUploadSessionDetail(
  session: UploadSession,
  chunks: UploadChunk[],
): UploadSessionDetailResult {
  const uploadedParts = chunks.map(toUploadChunkDto);
  const uploadedPartNumbers = chunks
    .filter((chunk) => chunk.status !== "rejected")
    .map((chunk) => chunk.partNumber);
  const missingPartNumbers =
    session.uploadType === "multipart"
      ? getMissingPartNumbers({
          totalSizeBytes: session.totalSizeBytes,
          chunkSizeBytes: session.chunkSizeBytes,
          uploadedPartNumbers,
        })
      : [];
  const partCount =
    session.uploadType === "multipart" && session.chunkSizeBytes
      ? calculatePartCount(session.totalSizeBytes, session.chunkSizeBytes)
      : 0;

  return {
    uploadSessionId: session.id,
    fileId: session.targetFileId,
    status: session.status,
    uploadType: session.uploadType === "multipart" ? "multipart" : "single_part",
    totalSizeBytes: session.totalSizeBytes.toString(),
    receivedBytes: session.receivedBytes.toString(),
    chunkSizeBytes: session.chunkSizeBytes?.toString() ?? null,
    partCount,
    uploadedParts,
    missingPartNumbers,
    correlationId: session.correlationId,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function toUploadChunkDto(chunk: UploadChunk): UploadChunkDto {
  return {
    id: chunk.id,
    partNumber: chunk.partNumber,
    sizeBytes: chunk.sizeBytes.toString(),
    sha256: chunk.sha256,
    etag: chunk.etag,
    status: chunk.status,
    createdAt: chunk.createdAt.toISOString(),
    updatedAt: chunk.updatedAt.toISOString(),
  };
}

async function expireSessionIfNeeded(
  session: UploadSession,
  prisma: PrismaClient,
): Promise<UploadSession> {
  if (!["created", "uploading"].includes(session.status)) {
    return session;
  }

  if (session.expiresAt.getTime() > Date.now()) {
    return session;
  }

  return prisma.$transaction(async (tx) => {
    await markUploadExpired(tx, session.id, session.targetFileId, {
      failTargetFile: session.uploadMode === "new_file",
    });

    return tx.uploadSession.findUniqueOrThrow({
      where: {
        id: session.id,
      },
    });
  });
}

async function signPartsForSession(
  session: UploadSession,
  partNumbers: number[],
  storage: ObjectStorageProvider,
  options: UploadServiceOptions,
): Promise<SignedPartUploadDto[]> {
  if (!session.multipartUploadId || !session.chunkSizeBytes) {
    return [];
  }

  const uploadId = session.multipartUploadId;
  const chunkSizeBytes = session.chunkSizeBytes;

  return Promise.all(
    partNumbers.map(async (partNumber) => {
      const signedPart = await storage.createSignedPartUploadUrl({
        bucket: session.bucket,
        objectKey: session.finalObjectKey,
        uploadId,
        partNumber,
        expiresInSeconds: options.signedUploadUrlTtlSeconds,
      });

      return {
        partNumber,
        sizeBytes: getExpectedPartSize({
          totalSizeBytes: session.totalSizeBytes,
          chunkSizeBytes,
          partNumber,
        }).toString(),
        url: signedPart.url,
        method: "PUT" as const,
        expiresAt: signedPart.expiresAt.toISOString(),
        headers: {},
      };
    }),
  );
}
