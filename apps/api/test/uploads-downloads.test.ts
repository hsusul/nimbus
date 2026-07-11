import { getApiConfig, type ApiConfig } from "@nimbus/config";
import { getPrismaClient } from "@nimbus/db";
import { createLogger } from "@nimbus/logger";
import type {
  AbortMultipartUploadInput,
  CompleteMultipartUploadInput,
  CompleteMultipartUploadResult,
  CreateMultipartUploadInput,
  CreateMultipartUploadResult,
  ObjectLocation,
  ObjectMetadata,
  ObjectStorageProvider,
  SignedDownloadUrlInput,
  SignedPartUploadUrlInput,
  SignedUploadUrlInput,
  SignedUrl,
} from "@nimbus/storage";
import { ObjectNotFoundError } from "@nimbus/storage";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import type { UploadFinalizationQueue } from "../src/services/queue";

class FakeObjectStorageProvider implements ObjectStorageProvider {
  private readonly objects = new Map<string, ObjectMetadata & { body: string }>();
  private readonly multipartUploads = new Map<string, ObjectLocation>();
  readonly abortedMultipartUploads: AbortMultipartUploadInput[] = [];
  private multipartSequence = 0;

  async createSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUrl> {
    return {
      url: `https://storage.test/upload?bucket=${input.bucket}&key=${encodeURIComponent(input.objectKey)}&signature=fake`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createSignedDownloadUrl(input: SignedDownloadUrlInput): Promise<SignedUrl> {
    return {
      url: `https://storage.test/download?bucket=${input.bucket}&key=${encodeURIComponent(input.objectKey)}&signature=fake`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createMultipartUpload(
    input: CreateMultipartUploadInput,
  ): Promise<CreateMultipartUploadResult> {
    this.multipartSequence += 1;
    const uploadId = `multipart-${this.multipartSequence}`;

    this.multipartUploads.set(uploadId, {
      bucket: input.bucket,
      objectKey: input.objectKey,
    });

    return {
      uploadId,
    };
  }

  async createSignedPartUploadUrl(input: SignedPartUploadUrlInput): Promise<SignedUrl> {
    return {
      url: `https://storage.test/upload-part?bucket=${input.bucket}&uploadId=${input.uploadId}&partNumber=${input.partNumber}&signature=fake`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async completeMultipartUpload(
    _input: CompleteMultipartUploadInput,
  ): Promise<CompleteMultipartUploadResult> {
    return {
      etag: "fake-multipart-etag",
    };
  }

  async abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void> {
    this.abortedMultipartUploads.push(input);
    this.multipartUploads.delete(input.uploadId);
  }

  async headObject(input: ObjectLocation): Promise<ObjectMetadata> {
    const object = this.objects.get(toObjectMapKey(input));

    if (!object) {
      throw new ObjectNotFoundError(input.bucket, input.objectKey);
    }

    return object;
  }

  async deleteObject(input: ObjectLocation): Promise<void> {
    this.objects.delete(toObjectMapKey(input));
  }

  putObject(input: ObjectLocation & { sizeBytes: bigint; contentType: string; body: string }) {
    this.objects.set(toObjectMapKey(input), {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
      etag: "fake-etag",
      contentType: input.contentType,
      metadata: {},
      body: input.body,
    });
  }
}

class FakeUploadFinalizationQueue implements UploadFinalizationQueue {
  readonly jobs: Array<{
    uploadSessionId: string;
    backgroundJobId: string;
    correlationId?: string | null;
  }> = [];

  async enqueueUploadFinalization(input: {
    uploadSessionId: string;
    backgroundJobId: string;
    correlationId?: string | null;
  }): Promise<{ bullmqJobId: string }> {
    this.jobs.push(input);

    return {
      bullmqJobId: `bull-${input.backgroundJobId}`,
    };
  }
}

const testConfig: ApiConfig = {
  ...getApiConfig({ NODE_ENV: "test", DEPLOYMENT_PROFILE: "test" }),
  nodeEnv: "test",
  logLevel: "error",
  host: "127.0.0.1",
  port: 0,
  corsOrigin: "http://localhost:3000",
  authMode: "dev",
  devAuthEnabled: true,
  maxFolderDepth: 32,
  maxFileSizeBytes: 5368709120,
  signedUploadUrlTtlSeconds: 900,
  signedDownloadUrlTtlSeconds: 300,
  uploadSessionTtlSeconds: 86400,
  multipartUploadThresholdBytes: 67108864,
  multipartChunkSizeBytes: 8388608,
  databaseUrl: "postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public",
  redisUrl: "redis://localhost:6379",
  storage: {
    endpoint: "http://localhost:9000",
    accessKey: "nimbus",
    secretKey: "nimbus-secret",
    bucket: "nimbus-test",
    region: "us-east-1",
    forcePathStyle: true,
    signedUploadUrlTtlSeconds: 900,
    signedDownloadUrlTtlSeconds: 300,
  },
};

const runId = `m3-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const prisma = getPrismaClient();
const storage = new FakeObjectStorageProvider();
const uploadFinalizationQueue = new FakeUploadFinalizationQueue();
const m8JobScheduler = {
  scheduleMetadata: async () => "m8-metadata-test-job",
  scheduleThumbnail: async () => "m8-thumbnail-test-job",
  scheduleCleanup: async () => "m8-cleanup-test-job",
};
const app = createApp({
  config: testConfig,
  readinessChecker: async () => ({ postgres: true, redis: true }),
  storageProvider: storage,
  uploadFinalizationQueue,
  m8JobScheduler,
});

function authHeaders(userSlug: string) {
  return {
    "x-nimbus-dev-user": `${runId}-${userSlug}`,
    "x-nimbus-dev-email": `${userSlug}@${runId}.nimbus.test`,
  };
}

async function ensureRootFolder(userSlug: string): Promise<string> {
  const response = await request(app).get("/api/v1/me").set(authHeaders(userSlug)).expect(200);

  return response.body.data.rootFolderId as string;
}

async function startUpload(userSlug: string, filename: string, totalSizeBytes = "5") {
  const rootFolderId = await ensureRootFolder(userSlug);

  return request(app)
    .post("/api/v1/uploads/start")
    .set(authHeaders(userSlug))
    .send({
      folderId: rootFolderId,
      filename,
      mimeType: "text/plain",
      totalSizeBytes,
    })
    .expect(201);
}

async function startMultipartUpload(userSlug: string, filename: string) {
  const rootFolderId = await ensureRootFolder(userSlug);

  return request(app)
    .post("/api/v1/uploads/start")
    .set(authHeaders(userSlug))
    .send({
      folderId: rootFolderId,
      filename,
      mimeType: "application/octet-stream",
      totalSizeBytes: "20971520",
      uploadType: "multipart",
    })
    .expect(201);
}

async function startNewVersionUpload(
  userSlug: string,
  fileId: string,
  totalSizeBytes = "7",
  uploadType?: "single_part" | "multipart",
) {
  return request(app)
    .post("/api/v1/uploads/start")
    .set(authHeaders(userSlug))
    .send({
      uploadMode: "new_version",
      targetFileId: fileId,
      mimeType: uploadType === "multipart" ? "application/octet-stream" : "text/markdown",
      totalSizeBytes,
      ...(uploadType ? { uploadType } : {}),
    })
    .expect(201);
}

function registerPart(userSlug: string, uploadSessionId: string, partNumber: number) {
  const sizeBytes = partNumber === 3 ? "4194304" : "8388608";

  return request(app)
    .post(`/api/v1/uploads/${uploadSessionId}/chunks`)
    .set(authHeaders(userSlug))
    .send({
      partNumber,
      etag: `etag-${partNumber}`,
      sizeBytes,
    });
}

async function cleanupRunData() {
  const users = await prisma.user.findMany({
    where: {
      email: {
        endsWith: `@${runId}.nimbus.test`,
      },
    },
    select: {
      id: true,
    },
  });
  const userIds = users.map((user) => user.id);

  if (userIds.length === 0) {
    return;
  }

  await prisma.share.deleteMany({
    where: {
      OR: [{ createdById: { in: userIds } }, { granteeUserId: { in: userIds } }],
    },
  });
  await prisma.shareLink.deleteMany({
    where: {
      createdById: { in: userIds },
    },
  });

  await prisma.auditLog.deleteMany({
    where: {
      actorUserId: {
        in: userIds,
      },
    },
  });
  await prisma.fileVersion.deleteMany({
    where: {
      createdById: {
        in: userIds,
      },
    },
  });
  await prisma.backgroundJob.deleteMany({
    where: {
      ownerId: {
        in: userIds,
      },
    },
  });
  await prisma.uploadChunk.deleteMany({
    where: {
      ownerId: {
        in: userIds,
      },
    },
  });
  await prisma.uploadSession.deleteMany({
    where: {
      ownerId: {
        in: userIds,
      },
    },
  });
  await prisma.file.deleteMany({
    where: {
      ownerId: {
        in: userIds,
      },
    },
  });

  for (let depth = 32; depth >= 0; depth -= 1) {
    await prisma.folder.deleteMany({
      where: {
        ownerId: {
          in: userIds,
        },
        depth,
      },
    });
  }

  await prisma.user.deleteMany({
    where: {
      id: {
        in: userIds,
      },
    },
  });
}

beforeAll(async () => {
  await cleanupRunData();
});

afterAll(async () => {
  await cleanupRunData();
});

describe.sequential("single-part uploads and signed downloads", () => {
  it("starts a single-part upload and does not expose object keys", async () => {
    const response = await startUpload("start", "Private Report.txt");
    const responseText = JSON.stringify(response.body);

    expect(response.body.data.uploadSessionId).toEqual(expect.any(String));
    expect(response.body.data.fileId).toEqual(expect.any(String));
    expect(response.body.data.uploadMode).toBe("new_file");
    expect(response.body.data.status).toBe("created");
    expect(response.body.data.signedUpload.url).toContain("signature=fake");
    expect(responseText).not.toContain("objects/");
    expect(responseText).not.toContain("Private Report.txt/");

    const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: response.body.data.uploadSessionId,
      },
    });

    expect(uploadSession.finalObjectKey).toContain(`/versions/${uploadSession.plannedVersionId}/`);
    expect(uploadSession.finalObjectKey).not.toContain("Private Report.txt");
  });

  it("enqueues completion and returns completing without finalizing synchronously", async () => {
    const userSlug = "enqueue";
    const filename = "Queued Object.txt";
    const rootFolderId = await ensureRootFolder(userSlug);
    const queueLengthBefore = uploadFinalizationQueue.jobs.length;
    const response = await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders(userSlug))
      .send({
        folderId: rootFolderId,
        filename,
        mimeType: "text/plain",
        totalSizeBytes: "5",
      })
      .expect(201);

    const completion = await request(app)
      .post(`/api/v1/uploads/${response.body.data.uploadSessionId}/complete`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(completion.body.data).toMatchObject({
      uploadSessionId: response.body.data.uploadSessionId,
      status: "completing",
      fileId: response.body.data.fileId,
      backgroundJobId: expect.any(String),
      correlationId: expect.any(String),
    });
    expect(uploadFinalizationQueue.jobs).toHaveLength(queueLengthBefore + 1);

    const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: response.body.data.uploadSessionId,
      },
    });
    const backgroundJob = await prisma.backgroundJob.findUniqueOrThrow({
      where: {
        id: completion.body.data.backgroundJobId,
      },
    });
    const fileVersionCount = await prisma.fileVersion.count({
      where: {
        uploadSessionId: uploadSession.id,
      },
    });

    expect(uploadSession.status).toBe("completing");
    expect(uploadSession.correlationId).toBe(completion.body.data.correlationId);
    expect(backgroundJob).toMatchObject({
      status: "queued",
      resourceType: "upload_session",
      resourceId: uploadSession.id,
      correlationId: completion.body.data.correlationId,
    });
    expect(backgroundJob.bullmqJobId).toBe(`bull-${backgroundJob.id}`);
    expect(fileVersionCount).toBe(0);

    const children = await request(app)
      .get(`/api/v1/folders/${rootFolderId}/children`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(children.body.data.children.map((child: { id: string }) => child.id)).not.toContain(
      response.body.data.fileId,
    );
  });

  it("does not let terminal upload placeholders reserve filenames", async () => {
    const userSlug = "terminal-placeholders";
    const filename = "Reusable Terminal Name.txt";
    const normalizedName = "reusable terminal name.txt";
    const rootFolderId = await ensureRootFolder(userSlug);
    const user = await prisma.user.findFirstOrThrow({
      where: {
        email: `${userSlug}@${runId}.nimbus.test`,
      },
    });
    const terminalFiles = await Promise.all(
      ["failed", "canceled", "expired"].map(async (uploadStatus) => {
        const file = await prisma.file.create({
          data: {
            ownerId: user.id,
            folderId: rootFolderId,
            name: filename,
            normalizedName,
            extension: "txt",
            mimeType: "text/plain",
            status: "failed",
            sizeBytes: 5n,
          },
        });

        await prisma.uploadSession.create({
          data: {
            ownerId: user.id,
            targetFolderId: rootFolderId,
            targetFileId: file.id,
            plannedVersionId: randomUUID(),
            uploadMode: "new_file",
            filename,
            mimeType: "text/plain",
            totalSizeBytes: 5n,
            finalObjectKey: `objects/${user.id}/${file.id}/versions/${randomUUID()}/content`,
            bucket: "nimbus-test",
            status: uploadStatus,
            expiresAt: new Date(Date.now() - 1000),
          },
        });

        return file;
      }),
    );

    const children = await request(app)
      .get(`/api/v1/folders/${rootFolderId}/children`)
      .set(authHeaders(userSlug))
      .expect(200);
    const childIds = children.body.data.children.map((child: { id: string }) => child.id);

    for (const file of terminalFiles) {
      expect(childIds).not.toContain(file.id);
    }

    await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders(userSlug))
      .send({
        folderId: rootFolderId,
        filename,
        mimeType: "text/plain",
        totalSizeBytes: "5",
      })
      .expect(201);
  });

  it("does not enqueue duplicate destructive finalization for duplicate completion", async () => {
    const response = await startUpload("complete", "Complete Object.txt");
    const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: response.body.data.uploadSessionId,
      },
    });

    storage.putObject({
      bucket: uploadSession.bucket,
      objectKey: uploadSession.finalObjectKey,
      sizeBytes: uploadSession.totalSizeBytes,
      contentType: uploadSession.mimeType,
      body: "hello-secret-bytes",
    });

    const queueLengthBefore = uploadFinalizationQueue.jobs.length;
    const completion = await request(app)
      .post(`/api/v1/uploads/${uploadSession.id}/complete`)
      .set(authHeaders("complete"))
      .expect(200);

    expect(completion.body.data).toMatchObject({
      uploadSessionId: uploadSession.id,
      status: "completing",
      fileId: response.body.data.fileId,
      backgroundJobId: expect.any(String),
    });

    await request(app)
      .post(`/api/v1/uploads/${uploadSession.id}/complete`)
      .set(authHeaders("complete"))
      .expect(200)
      .expect((duplicate) => {
        expect(duplicate.body.data).toMatchObject({
          uploadSessionId: uploadSession.id,
          status: "completing",
          fileId: response.body.data.fileId,
          backgroundJobId: completion.body.data.backgroundJobId,
        });
      });

    const fileVersionCount = await prisma.fileVersion.count({
      where: {
        uploadSessionId: uploadSession.id,
      },
    });
    const persistedMetadata = JSON.stringify(
      { completion: completion.body.data, uploadSession },
      (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    );

    expect(fileVersionCount).toBe(0);
    expect(uploadFinalizationQueue.jobs).toHaveLength(queueLengthBefore + 1);
    expect(persistedMetadata).not.toContain("hello-secret-bytes");
  });

  it("prevents another user from completing an upload session", async () => {
    const response = await startUpload("owner", "Owner Upload.txt");

    await ensureRootFolder("intruder");
    await request(app)
      .post(`/api/v1/uploads/${response.body.data.uploadSessionId}/complete`)
      .set(authHeaders("intruder"))
      .expect(404);
  });

  it("creates signed download URLs for owners only and writes audit logs", async () => {
    const response = await startUpload("download", "Downloadable.txt", "8");
    const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: response.body.data.uploadSessionId,
      },
    });

    storage.putObject({
      bucket: uploadSession.bucket,
      objectKey: uploadSession.finalObjectKey,
      sizeBytes: uploadSession.totalSizeBytes,
      contentType: uploadSession.mimeType,
      body: "download",
    });

    await markUploadCompleted(uploadSession.id);

    const download = await request(app)
      .get(`/api/v1/files/${response.body.data.fileId}/download`)
      .set(authHeaders("download"))
      .expect(200);

    expect(download.body.data).toMatchObject({
      filename: "Downloadable.txt",
      sizeBytes: "8",
      mimeType: "text/plain",
    });
    expect(download.body.data.url).toContain("download");

    await ensureRootFolder("download-intruder");
    await request(app)
      .get(`/api/v1/files/${response.body.data.fileId}/download`)
      .set(authHeaders("download-intruder"))
      .expect(404);

    const auditResponse = await request(app)
      .get("/api/v1/audit-logs")
      .query({ limit: 20 })
      .set(authHeaders("download"))
      .expect(200);
    const actions = auditResponse.body.data.auditLogs.map((log: { action: string }) => log.action);

    expect(actions).toEqual(
      expect.arrayContaining(["upload.started", "upload.completed", "file.download_requested"]),
    );
    expect(JSON.stringify(auditResponse.body)).not.toContain(download.body.data.url);
  });
});

describe.sequential("file versioning", () => {
  it("uploads a new single-part version, lists versions, restores the older version, and downloads it", async () => {
    const userSlug = "versions";
    const initial = await startUpload(userSlug, "Versioned.txt", "5");
    const initialSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: initial.body.data.uploadSessionId,
      },
    });
    storage.putObject({
      bucket: initialSession.bucket,
      objectKey: initialSession.finalObjectKey,
      sizeBytes: initialSession.totalSizeBytes,
      contentType: initialSession.mimeType,
      body: "first",
    });
    const versionOne = await markUploadCompleted(initialSession.id);
    const queueLengthBefore = uploadFinalizationQueue.jobs.length;

    const second = await startNewVersionUpload(userSlug, initial.body.data.fileId, "7");

    expect(second.body.data).toMatchObject({
      fileId: initial.body.data.fileId,
      uploadMode: "new_version",
      uploadType: "single_part",
    });

    const secondSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: second.body.data.uploadSessionId,
      },
    });

    expect(secondSession).toMatchObject({
      uploadMode: "new_version",
      targetFileId: initial.body.data.fileId,
      targetFolderId: initialSession.targetFolderId,
      filename: "Versioned.txt",
    });

    storage.putObject({
      bucket: secondSession.bucket,
      objectKey: secondSession.finalObjectKey,
      sizeBytes: secondSession.totalSizeBytes,
      contentType: secondSession.mimeType,
      body: "second!",
    });

    const completion = await request(app)
      .post(`/api/v1/uploads/${secondSession.id}/complete`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(completion.body.data).toMatchObject({
      uploadSessionId: secondSession.id,
      fileId: initial.body.data.fileId,
      status: "completing",
      backgroundJobId: expect.any(String),
    });
    expect(uploadFinalizationQueue.jobs).toHaveLength(queueLengthBefore + 1);

    const versionTwo = await markUploadCompleted(secondSession.id);
    const fileCount = await prisma.file.count({
      where: {
        ownerId: secondSession.ownerId,
        name: "Versioned.txt",
      },
    });

    expect(fileCount).toBe(1);

    const list = await request(app)
      .get(`/api/v1/files/${initial.body.data.fileId}/versions`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(
      list.body.data.versions.map((version: { versionNumber: number }) => version.versionNumber),
    ).toEqual([2, 1]);
    expect(list.body.data.versions[0]).toMatchObject({
      versionId: versionTwo.id,
      sizeBytes: "7",
      mimeType: "text/markdown",
      contentHash: null,
      isCurrent: true,
    });
    expect(list.body.data.versions[1]).toMatchObject({
      versionId: versionOne.id,
      sizeBytes: "5",
      mimeType: "text/plain",
      isCurrent: false,
    });

    const restored = await request(app)
      .post(`/api/v1/files/${initial.body.data.fileId}/versions/${versionOne.id}/restore`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(restored.body.data.file).toMatchObject({
      id: initial.body.data.fileId,
      currentVersionId: versionOne.id,
      sizeBytes: "5",
      mimeType: "text/plain",
    });
    expect(restored.body.data.currentVersion).toMatchObject({
      versionId: versionOne.id,
      isCurrent: true,
    });

    const download = await request(app)
      .get(`/api/v1/files/${initial.body.data.fileId}/download`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(download.body.data.sizeBytes).toBe("5");
    expect(download.body.data.url).toContain(encodeURIComponent(versionOne.id));

    const auditResponse = await request(app)
      .get("/api/v1/audit-logs")
      .query({ limit: 20 })
      .set(authHeaders(userSlug))
      .expect(200);
    const actions = auditResponse.body.data.auditLogs.map((log: { action: string }) => log.action);

    expect(actions).toEqual(
      expect.arrayContaining(["file.version_uploaded", "file.version_restored"]),
    );
    expect(JSON.stringify(auditResponse.body)).not.toContain(second.body.data.signedUpload.url);
  });

  it("supports multipart upload sessions for new versions", async () => {
    const userSlug = "versions-multipart";
    const initial = await startUpload(userSlug, "Multipart Versioned.bin", "5");
    await markUploadCompleted(initial.body.data.uploadSessionId);

    const second = await startNewVersionUpload(
      userSlug,
      initial.body.data.fileId,
      "20971520",
      "multipart",
    );
    const uploadSessionId = second.body.data.uploadSessionId as string;

    expect(second.body.data).toMatchObject({
      fileId: initial.body.data.fileId,
      uploadMode: "new_version",
      uploadType: "multipart",
    });
    expect(second.body.data.multipart.signedParts).toHaveLength(3);

    await registerPart(userSlug, uploadSessionId, 1).expect(201);
    await registerPart(userSlug, uploadSessionId, 2).expect(201);
    await registerPart(userSlug, uploadSessionId, 3).expect(201);

    await request(app)
      .post(`/api/v1/uploads/${uploadSessionId}/complete`)
      .set(authHeaders(userSlug))
      .expect(200)
      .expect((completion) => {
        expect(completion.body.data).toMatchObject({
          uploadSessionId,
          fileId: initial.body.data.fileId,
          status: "completing",
        });
      });

    const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: uploadSessionId,
      },
    });

    expect(uploadSession).toMatchObject({
      uploadMode: "new_version",
      targetFileId: initial.body.data.fileId,
      receivedBytes: 20971520n,
    });
  });

  it("rejects cross-user, deleted-file, and unavailable version operations", async () => {
    const owner = "versions-owner";
    const intruder = "versions-intruder";
    const initial = await startUpload(owner, "Owner Versioned.txt", "5");
    const versionOne = await markUploadCompleted(initial.body.data.uploadSessionId);

    await ensureRootFolder(intruder);
    await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders(intruder))
      .send({
        uploadMode: "new_version",
        targetFileId: initial.body.data.fileId,
        mimeType: "text/plain",
        totalSizeBytes: "6",
      })
      .expect(404);
    await request(app)
      .get(`/api/v1/files/${initial.body.data.fileId}/versions`)
      .set(authHeaders(intruder))
      .expect(404);
    await request(app)
      .post(`/api/v1/files/${initial.body.data.fileId}/versions/${versionOne.id}/restore`)
      .set(authHeaders(intruder))
      .expect(404);

    const unavailableVersion = await createUnavailableVersion(initial.body.data.fileId, "failed");

    await request(app)
      .post(`/api/v1/files/${initial.body.data.fileId}/versions/${unavailableVersion.id}/restore`)
      .set(authHeaders(owner))
      .expect(409)
      .expect((response) => {
        expect(response.body.error.code).toBe("file_version_not_available");
      });

    await request(app)
      .delete(`/api/v1/files/${initial.body.data.fileId}`)
      .set(authHeaders(owner))
      .expect(200);
    await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders(owner))
      .send({
        uploadMode: "new_version",
        targetFileId: initial.body.data.fileId,
        mimeType: "text/plain",
        totalSizeBytes: "6",
      })
      .expect(404);
    await request(app)
      .post(`/api/v1/files/${initial.body.data.fileId}/versions/${versionOne.id}/restore`)
      .set(authHeaders(owner))
      .expect(404);
  });
});

describe.sequential("multipart resumable uploads", () => {
  it("starts a multipart upload with signed part metadata", async () => {
    const response = await startMultipartUpload("multipart-start", "Large.bin");
    const firstSignedPartUrl = response.body.data.multipart.signedParts[0].url as string;

    expect(response.body.data).toMatchObject({
      uploadSessionId: expect.any(String),
      fileId: expect.any(String),
      status: "created",
      uploadType: "multipart",
      multipart: {
        chunkSizeBytes: "8388608",
        partCount: 3,
        signedParts: [
          expect.objectContaining({ partNumber: 1, method: "PUT", sizeBytes: "8388608" }),
          expect.objectContaining({ partNumber: 2, method: "PUT", sizeBytes: "8388608" }),
          expect.objectContaining({ partNumber: 3, method: "PUT", sizeBytes: "4194304" }),
        ],
      },
    });

    const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: response.body.data.uploadSessionId,
      },
    });

    expect(uploadSession).toMatchObject({
      uploadType: "multipart",
      multipartUploadId: expect.any(String),
      receivedBytes: 0n,
    });
    expect(uploadSession.chunkSizeBytes).toBe(8388608n);

    const auditLog = await prisma.auditLog.findFirstOrThrow({
      where: {
        resourceType: "upload_session",
        resourceId: uploadSession.id,
        action: "upload.started",
      },
    });
    const auditJson = JSON.stringify(auditLog);

    expect(auditJson).not.toContain(firstSignedPartUrl);
    expect(auditJson).not.toContain("upload-part");
    expect(auditJson).not.toContain("signature=fake");
  });

  it("registers chunks idempotently and returns resume state", async () => {
    const response = await startMultipartUpload("multipart-register", "Resume.bin");
    const uploadSessionId = response.body.data.uploadSessionId as string;

    const first = await registerPart("multipart-register", uploadSessionId, 1).expect(201);

    expect(first.body.data).toMatchObject({
      uploadSessionId,
      status: "uploading",
      receivedBytes: "8388608",
      chunk: expect.objectContaining({
        partNumber: 1,
        etag: "etag-1",
        sizeBytes: "8388608",
        status: "uploaded",
      }),
      missingPartNumbers: [2, 3],
    });

    const duplicate = await registerPart("multipart-register", uploadSessionId, 1).expect(201);

    expect(duplicate.body.data).toMatchObject({
      uploadSessionId,
      receivedBytes: "8388608",
      missingPartNumbers: [2, 3],
    });

    await request(app)
      .post(`/api/v1/uploads/${uploadSessionId}/chunks`)
      .set(authHeaders("multipart-register"))
      .send({
        partNumber: 1,
        etag: "different-etag",
        sizeBytes: "8388608",
      })
      .expect(409);

    const detail = await request(app)
      .get(`/api/v1/uploads/${uploadSessionId}`)
      .set(authHeaders("multipart-register"))
      .expect(200);

    expect(detail.body.data).toMatchObject({
      uploadSessionId,
      status: "uploading",
      uploadType: "multipart",
      receivedBytes: "8388608",
      missingPartNumbers: [2, 3],
    });
    expect(detail.body.data.uploadedParts).toHaveLength(1);
    expect(detail.body.data.signedParts).toHaveLength(2);

    const chunks = await request(app)
      .get(`/api/v1/uploads/${uploadSessionId}/chunks`)
      .set(authHeaders("multipart-register"))
      .expect(200);

    expect(chunks.body.data).toMatchObject({
      uploadSessionId,
      missingPartNumbers: [2, 3],
    });
    expect(chunks.body.data.uploadedParts).toHaveLength(1);
  });

  it("rejects completion with missing chunks and queues when all chunks are registered", async () => {
    const response = await startMultipartUpload("multipart-complete", "Complete Large.bin");
    const uploadSessionId = response.body.data.uploadSessionId as string;

    await registerPart("multipart-complete", uploadSessionId, 1).expect(201);

    await request(app)
      .post(`/api/v1/uploads/${uploadSessionId}/complete`)
      .set(authHeaders("multipart-complete"))
      .expect(409)
      .expect((missing) => {
        expect(missing.body.error.code).toBe("upload_parts_missing");
        expect(missing.body.error.details.missingPartNumbers).toEqual([2, 3]);
      });

    await registerPart("multipart-complete", uploadSessionId, 2).expect(201);
    await registerPart("multipart-complete", uploadSessionId, 3).expect(201);

    const queueLengthBefore = uploadFinalizationQueue.jobs.length;
    const completion = await request(app)
      .post(`/api/v1/uploads/${uploadSessionId}/complete`)
      .set(authHeaders("multipart-complete"))
      .expect(200);

    expect(completion.body.data).toMatchObject({
      uploadSessionId,
      status: "completing",
      fileId: response.body.data.fileId,
      backgroundJobId: expect.any(String),
    });
    expect(uploadFinalizationQueue.jobs).toHaveLength(queueLengthBefore + 1);

    const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: uploadSessionId,
      },
    });
    const backgroundJob = await prisma.backgroundJob.findUniqueOrThrow({
      where: {
        id: completion.body.data.backgroundJobId,
      },
    });
    const jobJson = JSON.stringify(backgroundJob);

    expect(uploadSession).toMatchObject({
      status: "completing",
      receivedBytes: 20971520n,
    });
    expect(jobJson).not.toContain("upload-part");
    expect(jobJson).not.toContain("signature=fake");
  });

  it("does not write signed part URLs to API logger output", async () => {
    const logLines: string[] = [];
    const loggedApp = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      storageProvider: storage,
      uploadFinalizationQueue,
      m8JobScheduler,
      logger: createLogger({
        service: "multipart-logger-test",
        level: "info",
        sink: (line) => logLines.push(line),
      }),
    });
    const rootFolderId = await ensureRootFolder("multipart-logger");
    const response = await request(loggedApp)
      .post("/api/v1/uploads/start")
      .set(authHeaders("multipart-logger"))
      .send({
        folderId: rootFolderId,
        filename: "Logger Large.bin",
        mimeType: "application/octet-stream",
        totalSizeBytes: "20971520",
        uploadType: "multipart",
      })
      .expect(201);
    const logOutput = logLines.join("\n");

    expect(response.body.data.multipart.signedParts[0].url).toContain("signature=fake");
    expect(logOutput).not.toContain(response.body.data.multipart.signedParts[0].url);
    expect(logOutput).not.toContain("upload-part");
    expect(logOutput).not.toContain("signature=fake");
  });

  it("cancels multipart uploads, hides placeholders, and allows filename reuse", async () => {
    const userSlug = "multipart-cancel";
    const filename = "Canceled Large.bin";
    const rootFolderId = await ensureRootFolder(userSlug);
    const response = await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders(userSlug))
      .send({
        folderId: rootFolderId,
        filename,
        mimeType: "application/octet-stream",
        totalSizeBytes: "20971520",
        uploadType: "multipart",
      })
      .expect(201);
    const abortCountBefore = storage.abortedMultipartUploads.length;

    const cancellation = await request(app)
      .post(`/api/v1/uploads/${response.body.data.uploadSessionId}/cancel`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(cancellation.body.data).toMatchObject({
      uploadSessionId: response.body.data.uploadSessionId,
      fileId: response.body.data.fileId,
      status: "canceled",
      abortedMultipartUpload: true,
    });
    expect(storage.abortedMultipartUploads).toHaveLength(abortCountBefore + 1);

    const children = await request(app)
      .get(`/api/v1/folders/${rootFolderId}/children`)
      .set(authHeaders(userSlug))
      .expect(200);

    expect(children.body.data.children.map((child: { id: string }) => child.id)).not.toContain(
      response.body.data.fileId,
    );

    await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders(userSlug))
      .send({
        folderId: rootFolderId,
        filename,
        mimeType: "application/octet-stream",
        totalSizeBytes: "20971520",
        uploadType: "multipart",
      })
      .expect(201);
  });

  it("does not allow another user to inspect, register, complete, or cancel an upload", async () => {
    const response = await startMultipartUpload("multipart-owner", "Private Large.bin");
    const uploadSessionId = response.body.data.uploadSessionId as string;

    await ensureRootFolder("multipart-intruder");

    await request(app)
      .get(`/api/v1/uploads/${uploadSessionId}`)
      .set(authHeaders("multipart-intruder"))
      .expect(404);
    await request(app)
      .get(`/api/v1/uploads/${uploadSessionId}/chunks`)
      .set(authHeaders("multipart-intruder"))
      .expect(404);
    await request(app)
      .post(`/api/v1/uploads/${uploadSessionId}/chunks`)
      .set(authHeaders("multipart-intruder"))
      .send({
        partNumber: 1,
        etag: "etag-1",
        sizeBytes: "8388608",
      })
      .expect(404);
    await request(app)
      .post(`/api/v1/uploads/${uploadSessionId}/complete`)
      .set(authHeaders("multipart-intruder"))
      .expect(404);
    await request(app)
      .post(`/api/v1/uploads/${uploadSessionId}/cancel`)
      .set(authHeaders("multipart-intruder"))
      .expect(404);
  });
});

async function markUploadCompleted(uploadSessionId: string) {
  const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
    where: {
      id: uploadSessionId,
    },
  });

  if (!uploadSession.targetFileId) {
    throw new Error("Upload session is missing a target file.");
  }

  const latestVersion = await prisma.fileVersion.findFirst({
    where: {
      fileId: uploadSession.targetFileId,
    },
    orderBy: {
      versionNumber: "desc",
    },
  });
  const fileVersion = await prisma.fileVersion.create({
    data: {
      id: uploadSession.plannedVersionId,
      fileId: uploadSession.targetFileId,
      versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
      storageProvider: "s3-compatible",
      bucket: uploadSession.bucket,
      objectKey: uploadSession.finalObjectKey,
      sizeBytes: uploadSession.totalSizeBytes,
      mimeType: uploadSession.mimeType,
      uploadSessionId: uploadSession.id,
      createdById: uploadSession.ownerId,
      processingStatus: "available",
    },
  });
  const file = await prisma.file.update({
    where: {
      id: uploadSession.targetFileId,
    },
    data: {
      status: "active",
      currentVersionId: fileVersion.id,
      sizeBytes: fileVersion.sizeBytes,
      mimeType: fileVersion.mimeType,
      contentHash: fileVersion.sha256,
    },
  });

  await prisma.uploadSession.update({
    where: {
      id: uploadSession.id,
    },
    data: {
      status: "completed",
      completedAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      actorUserId: uploadSession.ownerId,
      action:
        uploadSession.uploadMode === "new_version" ? "file.version_uploaded" : "upload.completed",
      resourceType: "file",
      resourceId: file.id,
      correlationId: uploadSession.correlationId,
      metadataJson: {
        uploadSessionId: uploadSession.id,
        fileVersionId: fileVersion.id,
        uploadMode: uploadSession.uploadMode,
        versionNumber: fileVersion.versionNumber,
      },
    },
  });

  return fileVersion;
}

async function createUnavailableVersion(fileId: string, processingStatus: string) {
  const file = await prisma.file.findUniqueOrThrow({
    where: {
      id: fileId,
    },
  });
  const latestVersion = await prisma.fileVersion.findFirst({
    where: {
      fileId,
    },
    orderBy: {
      versionNumber: "desc",
    },
  });
  const plannedVersionId = randomUUID();
  const uploadSession = await prisma.uploadSession.create({
    data: {
      ownerId: file.ownerId,
      targetFolderId: file.folderId,
      targetFileId: file.id,
      plannedVersionId,
      uploadMode: "new_version",
      filename: file.name,
      mimeType: file.mimeType ?? "application/octet-stream",
      totalSizeBytes: 9n,
      finalObjectKey: `objects/${file.ownerId}/${file.id}/versions/${plannedVersionId}/content`,
      bucket: "nimbus-test",
      status: "failed",
      failureReason: "test_unavailable_version",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  return prisma.fileVersion.create({
    data: {
      id: plannedVersionId,
      fileId: file.id,
      versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
      storageProvider: "s3-compatible",
      bucket: uploadSession.bucket,
      objectKey: uploadSession.finalObjectKey,
      sizeBytes: uploadSession.totalSizeBytes,
      mimeType: uploadSession.mimeType,
      uploadSessionId: uploadSession.id,
      createdById: uploadSession.ownerId,
      processingStatus,
    },
  });
}

function toObjectMapKey(input: ObjectLocation): string {
  return `${input.bucket}/${input.objectKey}`;
}
