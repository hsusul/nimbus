import type { ApiConfig } from "@nimbus/config";
import { getPrismaClient } from "@nimbus/db";
import type {
  ObjectLocation,
  ObjectMetadata,
  ObjectStorageProvider,
  SignedDownloadUrlInput,
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
  databaseUrl: "postgresql://nimbus:nimbus@localhost:5432/nimbus?schema=public",
  redisUrl: "redis://localhost:6379",
  storage: {
    endpoint: "http://localhost:9000",
    accessKey: "nimbus",
    secretKey: "nimbus-secret",
    bucket: "nimbus-test",
    region: "us-east-1",
    signedUploadUrlTtlSeconds: 900,
    signedDownloadUrlTtlSeconds: 300,
  },
};

const runId = `m3-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const prisma = getPrismaClient();
const storage = new FakeObjectStorageProvider();
const uploadFinalizationQueue = new FakeUploadFinalizationQueue();
const app = createApp({
  config: testConfig,
  readinessChecker: async () => ({ postgres: true, redis: true }),
  storageProvider: storage,
  uploadFinalizationQueue,
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
      resourceType: "upload_session",
      uploadSession: {
        ownerId: {
          in: userIds,
        },
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

async function markUploadCompleted(uploadSessionId: string) {
  const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
    where: {
      id: uploadSessionId,
    },
  });

  if (!uploadSession.targetFileId) {
    throw new Error("Upload session is missing a target file.");
  }

  const fileVersion = await prisma.fileVersion.create({
    data: {
      id: uploadSession.plannedVersionId,
      fileId: uploadSession.targetFileId,
      versionNumber: 1,
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
      action: "upload.completed",
      resourceType: "file",
      resourceId: file.id,
      correlationId: uploadSession.correlationId,
      metadataJson: {
        uploadSessionId: uploadSession.id,
        fileVersionId: fileVersion.id,
      },
    },
  });
}

function toObjectMapKey(input: ObjectLocation): string {
  return `${input.bucket}/${input.objectKey}`;
}
