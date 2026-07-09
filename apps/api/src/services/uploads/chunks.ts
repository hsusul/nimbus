import type { RegisterUploadChunkRequest } from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient, type UploadChunk } from "@nimbus/db";

import { HttpError } from "../../middleware/error-handler";
import type { InternalUser } from "../users";
import { markUploadExpired, parseSizeBytes } from "./helpers";
import { getExpectedPartSize, getMissingPartNumbers } from "./multipart-plan";
import { toUploadChunkDto, type UploadChunkDto } from "./status";

export interface RegisterUploadChunkResult {
  uploadSessionId: string;
  status: string;
  receivedBytes: string;
  chunk: UploadChunkDto;
  missingPartNumbers: number[];
}

export async function registerUploadChunk(
  actor: InternalUser,
  uploadSessionId: string,
  input: RegisterUploadChunkRequest,
  prisma: PrismaClient = getPrismaClient(),
): Promise<RegisterUploadChunkResult> {
  const session = await prisma.uploadSession.findFirst({
    where: {
      id: uploadSessionId,
      ownerId: actor.id,
    },
  });

  if (!session) {
    throw new HttpError(404, "upload_session_not_found", "Upload session was not found.");
  }

  if (session.uploadType !== "multipart" || !session.chunkSizeBytes || !session.multipartUploadId) {
    throw new HttpError(409, "upload_not_multipart", "Upload session is not multipart.");
  }

  if (["completed", "completing", "failed", "canceled", "expired"].includes(session.status)) {
    throw new HttpError(409, "upload_not_registerable", "Upload session cannot accept chunks.");
  }

  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.$transaction(async (tx) => {
      await markUploadExpired(tx, session.id, session.targetFileId);
    });
    throw new HttpError(410, "upload_session_expired", "Upload session has expired.");
  }

  const sizeBytes = parseSizeBytes(input.sizeBytes);
  let expectedPartSize: bigint;

  try {
    expectedPartSize = getExpectedPartSize({
      totalSizeBytes: session.totalSizeBytes,
      chunkSizeBytes: session.chunkSizeBytes,
      partNumber: input.partNumber,
    });
  } catch {
    throw new HttpError(400, "part_number_out_of_range", "Part number is outside the upload plan.");
  }

  if (sizeBytes !== expectedPartSize) {
    throw new HttpError(400, "part_size_mismatch", "Part size does not match upload plan.", {
      expectedSizeBytes: expectedPartSize.toString(),
      actualSizeBytes: sizeBytes.toString(),
    });
  }

  const sha256 = input.sha256?.toLowerCase() ?? null;
  const result = await prisma.$transaction(async (tx) => {
    const existingChunk = await tx.uploadChunk.findUnique({
      where: {
        uploadSessionId_partNumber: {
          uploadSessionId: session.id,
          partNumber: input.partNumber,
        },
      },
    });

    if (existingChunk) {
      assertDuplicateChunkMatches(existingChunk, {
        etag: input.etag,
        sizeBytes,
        sha256,
      });
    }

    const chunk =
      existingChunk ??
      (await tx.uploadChunk.create({
        data: {
          uploadSessionId: session.id,
          ownerId: actor.id,
          partNumber: input.partNumber,
          sizeBytes,
          sha256,
          etag: input.etag,
          status: "uploaded",
        },
      }));

    const chunks = await tx.uploadChunk.findMany({
      where: {
        uploadSessionId: session.id,
      },
      orderBy: {
        partNumber: "asc",
      },
    });
    const receivedBytes = chunks.reduce((total, current) => total + current.sizeBytes, 0n);
    const updatedSession = await tx.uploadSession.update({
      where: {
        id: session.id,
      },
      data: {
        status: session.status === "created" ? "uploading" : session.status,
        receivedBytes,
        failureReason: null,
      },
    });

    return {
      chunk,
      chunks,
      status: updatedSession.status,
      receivedBytes,
    };
  });

  return {
    uploadSessionId: session.id,
    status: result.status,
    receivedBytes: result.receivedBytes.toString(),
    chunk: toUploadChunkDto(result.chunk),
    missingPartNumbers: getMissingPartNumbers({
      totalSizeBytes: session.totalSizeBytes,
      chunkSizeBytes: session.chunkSizeBytes,
      uploadedPartNumbers: result.chunks.map((chunk) => chunk.partNumber),
    }),
  };
}

function assertDuplicateChunkMatches(
  existingChunk: UploadChunk,
  input: { etag: string; sizeBytes: bigint; sha256: string | null },
) {
  if (
    existingChunk.etag !== input.etag ||
    existingChunk.sizeBytes !== input.sizeBytes ||
    existingChunk.sha256 !== input.sha256
  ) {
    throw new HttpError(
      409,
      "upload_chunk_conflict",
      "Part was already registered with different metadata.",
    );
  }
}
