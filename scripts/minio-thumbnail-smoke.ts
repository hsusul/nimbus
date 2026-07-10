import { THUMBNAIL_GENERATION_QUEUE_NAME } from "../packages/contracts/src/queues";
import { getWorkerConfig } from "../packages/config/src/index";
import { disconnectPrismaClient, getPrismaClient } from "../packages/db/src/index";
import { S3CompatibleStorageProvider } from "../packages/storage/src/minio-provider";
import {
  buildThumbnailObjectKey,
  buildVersionObjectKey,
} from "../packages/storage/src/object-keys";
import { generateThumbnail } from "../apps/worker/src/jobs/thumbnail-generation";
import { randomUUID } from "node:crypto";

const config = getWorkerConfig();
const prisma = getPrismaClient();
const storage = new S3CompatibleStorageProvider({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  accessKey: config.storage.accessKey,
  secretKey: config.storage.secretKey,
});
const runId = `thumbnail-smoke-${Date.now()}-${randomUUID()}`;
const source = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAMElEQVR4nGPQqDhBU8QwakHFaBCdGE1FGqMZ7cRoUaExWppWjFY4GqNVZsXgblUAAOi7OD26arz5AAAAAElFTkSuQmCC",
  "base64",
);
let sourceLocation: { bucket: string; objectKey: string } | null = null;
let thumbnailLocation: { bucket: string; objectKey: string } | null = null;

try {
  const owner = await prisma.user.create({
    data: { authSubject: runId, email: `${runId}@nimbus.local` },
  });
  const folder = await prisma.folder.create({
    data: { ownerId: owner.id, name: "Root", normalizedName: "root", depth: 0 },
  });
  const file = await prisma.file.create({
    data: {
      ownerId: owner.id,
      folderId: folder.id,
      name: "thumbnail-smoke.png",
      normalizedName: "thumbnail-smoke.png",
      extension: "png",
      mimeType: "image/png",
      sizeBytes: BigInt(source.byteLength),
      status: "active",
    },
  });
  const uploadSessionId = randomUUID();
  const versionId = randomUUID();
  const objectKey = buildVersionObjectKey({
    tenantId: owner.id,
    fileId: file.id,
    versionId,
  });
  sourceLocation = { bucket: config.storage.bucket, objectKey };
  await prisma.uploadSession.create({
    data: {
      id: uploadSessionId,
      ownerId: owner.id,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId: versionId,
      filename: file.name,
      mimeType: "image/png",
      totalSizeBytes: BigInt(source.byteLength),
      finalObjectKey: objectKey,
      bucket: config.storage.bucket,
      uploadType: "single_part",
      status: "completed",
      expiresAt: new Date(Date.now() + 60_000),
      completedAt: new Date(),
    },
  });
  const version = await prisma.fileVersion.create({
    data: {
      id: versionId,
      fileId: file.id,
      versionNumber: 1,
      storageProvider: "s3-compatible",
      bucket: config.storage.bucket,
      objectKey,
      sizeBytes: BigInt(source.byteLength),
      mimeType: "image/png",
      uploadSessionId,
      createdById: owner.id,
      processingStatus: "available",
    },
  });
  await prisma.file.update({
    where: { id: file.id },
    data: { currentVersionId: version.id },
  });
  const job = await prisma.backgroundJob.create({
    data: {
      ownerId: owner.id,
      queueName: THUMBNAIL_GENERATION_QUEUE_NAME,
      resourceType: "file_version",
      resourceId: version.id,
      status: "queued",
    },
  });

  if (!storage.writeObject) throw new Error("smoke_storage_write_unavailable");
  await storage.writeObject({
    ...sourceLocation,
    body: source,
    contentType: "image/png",
  });

  const startedAt = performance.now();
  await generateThumbnail(
    { fileVersionId: version.id, backgroundJobId: job.id, correlationId: runId },
    { prisma, storage, limits: config.thumbnail },
  );
  const durationMs = performance.now() - startedAt;
  const thumbnail = await prisma.thumbnail.findUniqueOrThrow({
    where: { fileVersionId: version.id },
  });
  thumbnailLocation = {
    bucket: config.storage.bucket,
    objectKey: buildThumbnailObjectKey({
      tenantId: owner.id,
      fileId: file.id,
      versionId: version.id,
    }),
  };
  const metadata = await storage.headObject(thumbnailLocation);

  if (thumbnail.status !== "complete" || metadata.contentType !== "image/webp") {
    throw new Error("smoke_thumbnail_not_complete");
  }
  if (thumbnail.objectKey !== thumbnailLocation.objectKey || metadata.sizeBytes <= 0n) {
    throw new Error("smoke_thumbnail_metadata_mismatch");
  }

  console.log(
    JSON.stringify({
      status: "ok",
      sourceBytes: source.byteLength,
      thumbnailBytes: metadata.sizeBytes.toString(),
      width: thumbnail.width,
      height: thumbnail.height,
      durationMs: Number(durationMs.toFixed(2)),
    }),
  );
} finally {
  if (thumbnailLocation) await storage.deleteObject(thumbnailLocation).catch(() => undefined);
  if (sourceLocation) await storage.deleteObject(sourceLocation).catch(() => undefined);
  await cleanupRows();
  await disconnectPrismaClient();
}

async function cleanupRows() {
  const user = await prisma.user.findUnique({ where: { authSubject: runId } });
  if (!user) return;
  await prisma.backgroundJob.deleteMany({ where: { ownerId: user.id } });
  await prisma.thumbnail.deleteMany({ where: { ownerId: user.id } });
  await prisma.file.updateMany({
    where: { ownerId: user.id },
    data: { currentVersionId: null },
  });
  await prisma.fileVersion.deleteMany({ where: { createdById: user.id } });
  await prisma.uploadSession.deleteMany({ where: { ownerId: user.id } });
  await prisma.file.deleteMany({ where: { ownerId: user.id } });
  await prisma.folder.deleteMany({ where: { ownerId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}
