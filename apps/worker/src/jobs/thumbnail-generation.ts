import {
  THUMBNAIL_GENERATION_QUEUE_NAME,
  ThumbnailGenerationJobPayloadSchema,
  type ThumbnailGenerationJobPayload,
} from "@nimbus/contracts";
import { getPrismaClient, type PrismaClient } from "@nimbus/db";
import {
  buildThumbnailObjectKey,
  ObjectNotFoundError,
  type ObjectStorageProvider,
} from "@nimbus/storage";
import sharp from "sharp";

import { markDurableJobFailed, markDurableJobRunning, markDurableJobSucceeded } from "./job-state";

export { THUMBNAIL_GENERATION_QUEUE_NAME };

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ThumbnailLimits {
  maxInputBytes: number;
  maxPixelCount: number;
  maxWidth: number;
  maxHeight: number;
  outputWidth: number;
  outputHeight: number;
  processingTimeoutMs: number;
}

export interface ThumbnailImageProcessor {
  createThumbnail(
    input: Uint8Array,
    limits: ThumbnailLimits,
  ): Promise<{ bytes: Uint8Array; width: number; height: number }>;
}

export interface ThumbnailGenerationDependencies {
  storage: ObjectStorageProvider;
  limits: ThumbnailLimits;
  prisma?: PrismaClient;
  imageProcessor?: ThumbnailImageProcessor;
}

export async function generateThumbnail(
  payload: ThumbnailGenerationJobPayload,
  dependencies: ThumbnailGenerationDependencies,
): Promise<void> {
  const parsed = ThumbnailGenerationJobPayloadSchema.parse(payload);
  const prisma = dependencies.prisma ?? getPrismaClient();
  const processor = dependencies.imageProcessor ?? new SharpThumbnailImageProcessor();
  const job = await markDurableJobRunning(parsed.backgroundJobId, prisma);

  if (
    job.queueName !== THUMBNAIL_GENERATION_QUEUE_NAME ||
    job.resourceType !== "file_version" ||
    job.resourceId !== parsed.fileVersionId
  ) {
    await markDurableJobFailed(job.id, "job_payload_mismatch", prisma);
    return;
  }

  const version = await prisma.fileVersion.findUnique({
    where: { id: parsed.fileVersionId },
    include: { file: true, thumbnail: true },
  });

  if (!version || version.file.ownerId !== job.ownerId) {
    await markDurableJobFailed(job.id, "thumbnail_source_not_found", prisma);
    return;
  }

  if (version.thumbnail?.status === "complete") {
    await markDurableJobSucceeded(job.id, prisma);
    return;
  }

  const thumbnail = await prisma.thumbnail.upsert({
    where: { fileVersionId: version.id },
    create: {
      ownerId: version.file.ownerId,
      fileId: version.fileId,
      fileVersionId: version.id,
      status: "pending",
    },
    update: {},
  });

  if (
    version.processingStatus !== "available" ||
    version.file.status !== "active" ||
    version.file.deletedAt
  ) {
    await markThumbnailSkipped(prisma, thumbnail.id, "thumbnail_source_unavailable");
    await markDurableJobSucceeded(job.id, prisma);
    return;
  }

  if (!SUPPORTED_MIME_TYPES.has(version.mimeType)) {
    await markThumbnailSkipped(prisma, thumbnail.id, "unsupported_mime_type");
    await markDurableJobSucceeded(job.id, prisma);
    return;
  }

  if (version.sizeBytes > BigInt(dependencies.limits.maxInputBytes)) {
    await markThumbnailFailed(prisma, thumbnail.id, "thumbnail_input_too_large");
    await markDurableJobFailed(job.id, "thumbnail_input_too_large", prisma);
    return;
  }

  if (!dependencies.storage.readObject || !dependencies.storage.writeObject) {
    await markThumbnailFailed(prisma, thumbnail.id, "storage_byte_io_unavailable");
    await markDurableJobFailed(job.id, "storage_byte_io_unavailable", prisma);
    return;
  }

  await prisma.thumbnail.update({
    where: { id: thumbnail.id },
    data: { status: "processing", failureCode: null, failedAt: null },
  });

  let input: Uint8Array;
  try {
    input = await dependencies.storage.readObject(
      { bucket: version.bucket, objectKey: version.objectKey },
      dependencies.limits.maxInputBytes,
    );
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      await markThumbnailFailed(prisma, thumbnail.id, "thumbnail_source_object_missing");
      await markDurableJobFailed(job.id, "thumbnail_source_object_missing", prisma);
      return;
    }
    await markThumbnailFailed(prisma, thumbnail.id, "thumbnail_storage_read_failed");
    await markDurableJobFailed(job.id, "thumbnail_storage_read_failed", prisma);
    throw error;
  }

  let output: { bytes: Uint8Array; width: number; height: number };
  try {
    output = await withTimeout(
      processor.createThumbnail(input, dependencies.limits),
      dependencies.limits.processingTimeoutMs,
    );
  } catch (error) {
    const failureCode =
      error instanceof ThumbnailProcessingError ? error.code : "thumbnail_processing_failed";
    await markThumbnailFailed(prisma, thumbnail.id, failureCode);
    await markDurableJobFailed(job.id, failureCode, prisma);
    return;
  }

  const objectKey = buildThumbnailObjectKey({
    tenantId: version.file.ownerId,
    fileId: version.fileId,
    versionId: version.id,
  });

  try {
    await dependencies.storage.writeObject({
      bucket: version.bucket,
      objectKey,
      body: output.bytes,
      contentType: "image/webp",
    });
  } catch (error) {
    await markThumbnailFailed(prisma, thumbnail.id, "thumbnail_storage_write_failed");
    await markDurableJobFailed(job.id, "thumbnail_storage_write_failed", prisma);
    throw error;
  }

  await prisma.thumbnail.update({
    where: { id: thumbnail.id },
    data: {
      status: "complete",
      bucket: version.bucket,
      objectKey,
      mimeType: "image/webp",
      width: output.width,
      height: output.height,
      sizeBytes: BigInt(output.bytes.byteLength),
      failureCode: null,
      completedAt: new Date(),
      failedAt: null,
    },
  });
  await markDurableJobSucceeded(job.id, prisma);
}

export class SharpThumbnailImageProcessor implements ThumbnailImageProcessor {
  async createThumbnail(
    input: Uint8Array,
    limits: ThumbnailLimits,
  ): Promise<{ bytes: Uint8Array; width: number; height: number }> {
    const source = Buffer.from(input);
    const metadata = await sharp(source, {
      failOn: "error",
      limitInputPixels: limits.maxPixelCount,
    }).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (!width || !height) {
      throw new ThumbnailProcessingError("thumbnail_dimensions_missing");
    }
    if (width > limits.maxWidth || height > limits.maxHeight) {
      throw new ThumbnailProcessingError("thumbnail_dimensions_exceeded");
    }
    if (width * height > limits.maxPixelCount) {
      throw new ThumbnailProcessingError("thumbnail_pixel_limit_exceeded");
    }

    const result = await sharp(source, {
      failOn: "error",
      limitInputPixels: limits.maxPixelCount,
    })
      .rotate()
      .resize({
        width: limits.outputWidth,
        height: limits.outputHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  }
}

class ThumbnailProcessingError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function markThumbnailSkipped(prisma: PrismaClient, id: string, failureCode: string) {
  await prisma.thumbnail.update({
    where: { id },
    data: { status: "skipped", failureCode, completedAt: new Date(), failedAt: null },
  });
}

async function markThumbnailFailed(prisma: PrismaClient, id: string, failureCode: string) {
  await prisma.thumbnail.update({
    where: { id },
    data: { status: "failed", failureCode, failedAt: new Date(), completedAt: null },
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () => reject(new ThumbnailProcessingError("thumbnail_processing_timeout")),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}
