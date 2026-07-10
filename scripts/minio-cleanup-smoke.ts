import { OBJECT_CLEANUP_QUEUE_NAME } from "../packages/contracts/src/queues";
import { getWorkerConfig } from "../packages/config/src/index";
import { disconnectPrismaClient, getPrismaClient } from "../packages/db/src/index";
import { S3CompatibleStorageProvider } from "../packages/storage/src/minio-provider";
import { buildVersionObjectKey } from "../packages/storage/src/object-keys";
import { ObjectNotFoundError } from "../packages/storage/src/provider";
import { cleanupUploadArtifacts } from "../apps/worker/src/jobs/object-cleanup";
import { randomUUID } from "node:crypto";

const config = getWorkerConfig();
const prisma = getPrismaClient();
const storage = new S3CompatibleStorageProvider({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  accessKey: config.storage.accessKey,
  secretKey: config.storage.secretKey,
});
const runId = `cleanup-smoke-${Date.now()}-${randomUUID()}`;
let location: { bucket: string; objectKey: string } | null = null;
let uploadId: string | null = null;

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
      name: "cleanup-smoke.bin",
      normalizedName: "cleanup-smoke.bin",
      status: "failed",
    },
  });
  const uploadSessionId = randomUUID();
  location = {
    bucket: config.storage.bucket,
    objectKey: buildVersionObjectKey({
      tenantId: owner.id,
      fileId: file.id,
      versionId: randomUUID(),
    }),
  };
  const multipart = await storage.createMultipartUpload({
    ...location,
    contentType: "application/octet-stream",
  });
  uploadId = multipart.uploadId;
  if (!storage.writeObject) throw new Error("smoke_storage_write_unavailable");
  await storage.writeObject({
    ...location,
    body: Buffer.from("orphaned upload artifact"),
    contentType: "application/octet-stream",
  });
  await prisma.uploadSession.create({
    data: {
      id: uploadSessionId,
      ownerId: owner.id,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId: randomUUID(),
      filename: file.name,
      mimeType: "application/octet-stream",
      totalSizeBytes: 24n,
      finalObjectKey: location.objectKey,
      bucket: location.bucket,
      uploadType: "multipart",
      multipartUploadId: uploadId,
      chunkSizeBytes: 5n * 1024n * 1024n,
      status: "canceled",
      expiresAt: new Date(Date.now() - 60_000),
    },
  });
  const job = await prisma.backgroundJob.create({
    data: {
      ownerId: owner.id,
      queueName: OBJECT_CLEANUP_QUEUE_NAME,
      resourceType: "upload_session",
      resourceId: uploadSessionId,
      status: "queued",
    },
  });

  const startedAt = performance.now();
  await cleanupUploadArtifacts(
    { uploadSessionId, backgroundJobId: job.id, correlationId: runId },
    { prisma, storage },
  );
  await cleanupUploadArtifacts(
    { uploadSessionId, backgroundJobId: job.id, correlationId: runId },
    { prisma, storage },
  );
  const durationMs = performance.now() - startedAt;

  try {
    await storage.headObject(location);
    throw new Error("smoke_orphan_object_still_exists");
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
  const durable = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
  if (durable.status !== "succeeded") throw new Error("smoke_cleanup_job_not_succeeded");

  console.log(
    JSON.stringify({
      status: "ok",
      multipartAborted: true,
      orphanDeleted: true,
      duplicateSafe: true,
      durationMs: Number(durationMs.toFixed(2)),
    }),
  );
} finally {
  if (location && uploadId) {
    await storage.abortMultipartUpload({ ...location, uploadId }).catch(() => undefined);
  }
  if (location) await storage.deleteObject(location).catch(() => undefined);
  await cleanupRows();
  await disconnectPrismaClient();
}

async function cleanupRows() {
  const user = await prisma.user.findUnique({ where: { authSubject: runId } });
  if (!user) return;
  await prisma.backgroundJob.deleteMany({ where: { ownerId: user.id } });
  await prisma.uploadSession.deleteMany({ where: { ownerId: user.id } });
  await prisma.file.deleteMany({ where: { ownerId: user.id } });
  await prisma.folder.deleteMany({ where: { ownerId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}
