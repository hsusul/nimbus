import { randomUUID } from "node:crypto";

import { getApiConfig } from "../packages/config/src/index";
import { disconnectPrismaClient, getPrismaClient } from "../packages/db/src/index";
import { S3CompatibleStorageProvider } from "../packages/storage/src/minio-provider";
import { finalizeUploadSession } from "../apps/worker/src/jobs/upload-finalization";
import { registerUploadChunk } from "../apps/api/src/services/uploads/chunks";
import { enqueueUploadCompletion } from "../apps/api/src/services/uploads/complete-upload";
import { startUpload } from "../apps/api/src/services/uploads/start-upload";
import type { UploadFinalizationQueue } from "../apps/api/src/services/queue";
import { PrismaUserService } from "../apps/api/src/services/users";

const config = getApiConfig();
const prisma = getPrismaClient();
const storage = new S3CompatibleStorageProvider({
  endpoint: config.storage.endpoint,
  region: config.storage.region,
  accessKey: config.storage.accessKey,
  secretKey: config.storage.secretKey,
});
const userService = new PrismaUserService(prisma);
const runId = `multipart-smoke-${Date.now()}-${randomUUID()}`;
const partOne = Buffer.alloc(5 * 1024 * 1024, "a");
const partTwo = Buffer.from("nimbus-minio-multipart-smoke\n");
const totalSizeBytes = BigInt(partOne.byteLength + partTwo.byteLength);
const queuedPayloads: Array<{
  uploadSessionId: string;
  backgroundJobId: string;
  correlationId?: string | null;
}> = [];
const queue: UploadFinalizationQueue = {
  async enqueueUploadFinalization(input) {
    queuedPayloads.push(input);

    return {
      bullmqJobId: `smoke-${input.backgroundJobId}`,
    };
  },
};

let uploadSessionId: string | null = null;
let objectLocation: { bucket: string; objectKey: string } | null = null;

try {
  const actor = await userService.ensureUser({
    authSubject: runId,
    email: `${runId}@nimbus.local`,
    displayName: "Multipart Smoke",
  });
  const auditContext = {
    actorUserId: actor.id,
    requestId: `req-${runId}`,
    correlationId: `corr-${runId}`,
  };
  const started = await startUpload(
    actor,
    {
      folderId: actor.rootFolderId,
      filename: `multipart-smoke-${Date.now()}.bin`,
      mimeType: "application/octet-stream",
      totalSizeBytes: totalSizeBytes.toString(),
      uploadType: "multipart",
      chunkSizeBytes: partOne.byteLength.toString(),
    },
    auditContext,
    storage,
    {
      bucket: config.storage.bucket,
      maxFileSizeBytes: config.maxFileSizeBytes,
      signedUploadUrlTtlSeconds: config.signedUploadUrlTtlSeconds,
      uploadSessionTtlSeconds: config.uploadSessionTtlSeconds,
      multipartUploadThresholdBytes: config.multipartUploadThresholdBytes,
      multipartChunkSizeBytes: config.multipartChunkSizeBytes,
    },
    prisma,
  );

  uploadSessionId = started.uploadSessionId;

  if (!started.multipart || started.multipart.signedParts.length !== 2) {
    throw new Error("smoke_expected_two_signed_parts");
  }

  const session = await prisma.uploadSession.findUniqueOrThrow({
    where: {
      id: uploadSessionId,
    },
  });
  objectLocation = {
    bucket: session.bucket,
    objectKey: session.finalObjectKey,
  };

  const uploadedParts = await Promise.all([
    uploadPart(started.multipart.signedParts[0]?.url, partOne),
    uploadPart(started.multipart.signedParts[1]?.url, partTwo),
  ]);

  await registerUploadChunk(
    actor,
    uploadSessionId,
    {
      partNumber: 1,
      etag: uploadedParts[0],
      sizeBytes: partOne.byteLength.toString(),
    },
    prisma,
  );
  await registerUploadChunk(
    actor,
    uploadSessionId,
    {
      partNumber: 2,
      etag: uploadedParts[1],
      sizeBytes: partTwo.byteLength.toString(),
    },
    prisma,
  );

  const completion = await enqueueUploadCompletion(
    actor,
    uploadSessionId,
    auditContext,
    queue,
    prisma,
  );
  const payload = queuedPayloads[0];

  if (!payload) {
    throw new Error("smoke_missing_finalization_payload");
  }

  await finalizeUploadSession(payload, {
    prisma,
    storage,
  });

  const metadata = await storage.headObject(objectLocation);

  if (metadata.sizeBytes !== totalSizeBytes) {
    throw new Error(
      `smoke_size_mismatch expected=${totalSizeBytes.toString()} actual=${metadata.sizeBytes.toString()}`,
    );
  }

  console.log(
    JSON.stringify({
      uploadSessionId,
      backgroundJobId: completion.backgroundJobId,
      bucket: metadata.bucket,
      sizeBytes: metadata.sizeBytes.toString(),
      etag: metadata.etag,
      status: "ok",
    }),
  );
} finally {
  if (objectLocation) {
    await storage.deleteObject(objectLocation).catch(() => undefined);
  }

  await cleanupSmokeRows(runId);
  await disconnectPrismaClient();
}

async function uploadPart(url: string | undefined, body: Buffer): Promise<string> {
  if (!url) {
    throw new Error("smoke_missing_signed_part_url");
  }

  const response = await fetch(url, {
    method: "PUT",
    body,
  });

  if (!response.ok) {
    throw new Error(
      `smoke_part_upload_failed status=${response.status} body=${await response.text()}`,
    );
  }

  const etag = response.headers.get("etag")?.replaceAll('"', "");

  if (!etag) {
    throw new Error("smoke_missing_part_etag");
  }

  return etag;
}

async function cleanupSmokeRows(authSubject: string) {
  const user = await prisma.user.findUnique({
    where: {
      authSubject,
    },
    select: {
      id: true,
    },
  });

  if (!user) {
    return;
  }

  await prisma.auditLog.deleteMany({
    where: {
      actorUserId: user.id,
    },
  });
  await prisma.file.updateMany({
    where: {
      ownerId: user.id,
    },
    data: {
      currentVersionId: null,
    },
  });
  await prisma.fileVersion.deleteMany({
    where: {
      createdById: user.id,
    },
  });
  await prisma.backgroundJob.deleteMany({
    where: {
      resourceType: "upload_session",
      uploadSession: {
        ownerId: user.id,
      },
    },
  });
  await prisma.uploadChunk.deleteMany({
    where: {
      ownerId: user.id,
    },
  });
  await prisma.uploadSession.deleteMany({
    where: {
      ownerId: user.id,
    },
  });
  await prisma.file.deleteMany({
    where: {
      ownerId: user.id,
    },
  });
  await prisma.folder.deleteMany({
    where: {
      ownerId: user.id,
    },
  });
  await prisma.user.delete({
    where: {
      id: user.id,
    },
  });
}
