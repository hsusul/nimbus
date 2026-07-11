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
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { hashShareLinkToken, PrismaPermissionService } from "../src/services/permission-service";
import type { InternalUser } from "../src/services/users";

class SharingStorageProvider implements ObjectStorageProvider {
  async createSignedDownloadUrl(input: SignedDownloadUrlInput): Promise<SignedUrl> {
    return {
      url: `https://storage.test/download?file=${encodeURIComponent(input.objectKey)}&signature=fake`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUrl> {
    return {
      url: `https://storage.test/upload?file=${encodeURIComponent(input.objectKey)}&signature=fake`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createMultipartUpload(
    _input: CreateMultipartUploadInput,
  ): Promise<CreateMultipartUploadResult> {
    throw new Error("Multipart creation should not be reached by denied sharing tests.");
  }

  async createSignedPartUploadUrl(_input: SignedPartUploadUrlInput): Promise<SignedUrl> {
    throw new Error("Part signing should not be reached by denied sharing tests.");
  }

  async completeMultipartUpload(
    _input: CompleteMultipartUploadInput,
  ): Promise<CompleteMultipartUploadResult> {
    throw new Error("Multipart completion is not used by sharing tests.");
  }

  async abortMultipartUpload(_input: AbortMultipartUploadInput): Promise<void> {}

  async headObject(_input: ObjectLocation): Promise<ObjectMetadata> {
    throw new Error("Object inspection is not used by sharing tests.");
  }

  async deleteObject(_input: ObjectLocation): Promise<void> {}
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

const runId = `m7-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const prisma = getPrismaClient();
const storage = new SharingStorageProvider();
const m8JobScheduler = {
  scheduleMetadata: async () => "m8-metadata-test-job",
  scheduleThumbnail: async () => "m8-thumbnail-test-job",
  scheduleCleanup: async () => "m8-cleanup-test-job",
};
const app = createApp({
  config: testConfig,
  readinessChecker: async () => ({ postgres: true, redis: true }),
  storageProvider: storage,
  uploadFinalizationQueue: {
    enqueueUploadFinalization: async () => ({ bullmqJobId: "unused" }),
  },
  m8JobScheduler,
});

function authHeaders(userSlug: string) {
  return {
    "x-nimbus-dev-user": `${runId}-${userSlug}`,
    "x-nimbus-dev-email": `${userSlug}@${runId}.nimbus.test`,
  };
}

async function ensureUser(userSlug: string): Promise<InternalUser> {
  const response = await request(app).get("/api/v1/me").set(authHeaders(userSlug)).expect(200);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: response.body.data.id },
  });

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? user.email,
    status: user.status,
    storageQuotaBytes: user.storageQuotaBytes,
    storageUsedBytes: user.storageUsedBytes,
    rootFolderId: response.body.data.rootFolderId,
  };
}

async function createAvailableFile(owner: InternalUser, name: string) {
  const fileId = randomUUID();
  const uploadSessionId = randomUUID();
  const versionId = randomUUID();
  const objectKey = `objects/${owner.id}/${fileId}/versions/${versionId}/content`;
  await prisma.file.create({
    data: {
      id: fileId,
      ownerId: owner.id,
      folderId: owner.rootFolderId,
      name,
      normalizedName: name.toLowerCase(),
      extension: "txt",
      mimeType: "text/plain",
      status: "active",
      sizeBytes: 12n,
    },
  });
  await prisma.uploadSession.create({
    data: {
      id: uploadSessionId,
      ownerId: owner.id,
      targetFolderId: owner.rootFolderId,
      targetFileId: fileId,
      plannedVersionId: versionId,
      filename: name,
      mimeType: "text/plain",
      totalSizeBytes: 12n,
      finalObjectKey: objectKey,
      bucket: "nimbus-test",
      status: "completed",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.fileVersion.create({
    data: {
      id: versionId,
      fileId,
      versionNumber: 1,
      storageProvider: "s3-compatible",
      bucket: "nimbus-test",
      objectKey,
      sizeBytes: 12n,
      mimeType: "text/plain",
      uploadSessionId,
      createdById: owner.id,
      processingStatus: "available",
    },
  });
  await prisma.file.update({ where: { id: fileId }, data: { currentVersionId: versionId } });

  return { fileId, versionId, uploadSessionId, objectKey, bucket: "nimbus-test" };
}

async function cleanupRunData() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${runId}.nimbus.test` } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  if (userIds.length === 0) return;

  await prisma.share.deleteMany({
    where: { OR: [{ createdById: { in: userIds } }, { granteeUserId: { in: userIds } }] },
  });
  await prisma.shareLink.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.thumbnail.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.fileVersion.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.backgroundJob.deleteMany({
    where: {
      ownerId: { in: userIds },
    },
  });
  await prisma.uploadSession.deleteMany({ where: { ownerId: { in: userIds } } });
  await prisma.file.deleteMany({ where: { ownerId: { in: userIds } } });
  for (let depth = 32; depth >= 0; depth -= 1) {
    await prisma.folder.deleteMany({ where: { ownerId: { in: userIds }, depth } });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeAll(cleanupRunData);
afterAll(cleanupRunData);

describe.sequential("M7 sharing", () => {
  it("allows owners and denies unrelated users through PermissionService", async () => {
    const owner = await ensureUser("permission-owner");
    const unrelated = await ensureUser("permission-unrelated");
    const file = await createAvailableFile(owner, "permission.txt");
    const permissions = new PrismaPermissionService();

    await expect(
      permissions.can(owner, "file.read", { resourceType: "file", resourceId: file.fileId }),
    ).resolves.toBe(true);
    await expect(
      permissions.can(unrelated, "file.read", {
        resourceType: "file",
        resourceId: file.fileId,
      }),
    ).resolves.toBe(false);
  });

  it("returns stable conflicts for concurrent duplicate direct shares", async () => {
    const owner = await ensureUser("concurrent-owner");
    const recipient = await ensureUser("concurrent-recipient");
    const file = await createAvailableFile(owner, "concurrent.txt");
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(app).post("/api/v1/shares").set(authHeaders("concurrent-owner")).send({
          resourceType: "file",
          resourceId: file.fileId,
          granteeEmail: recipient.email,
          role: "viewer",
        }),
      ),
    );

    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const conflicts = responses.filter((response) => response.status === 409);
    expect(conflicts).toHaveLength(3);
    expect(conflicts.map((response) => response.body.error.code)).toEqual([
      "share_already_exists",
      "share_already_exists",
      "share_already_exists",
    ]);
    expect(
      await prisma.share.count({
        where: {
          resourceType: "file",
          resourceId: file.fileId,
          granteeUserId: recipient.id,
          revokedAt: null,
        },
      }),
    ).toBe(1);
  });

  it("returns file_not_found consistently for unrelated authenticated file actions", async () => {
    const owner = await ensureUser("authorization-owner");
    await ensureUser("authorization-unrelated");
    const file = await createAvailableFile(owner, "authorization.txt");
    const headers = authHeaders("authorization-unrelated");
    const responses = await Promise.all([
      request(app).get(`/api/v1/files/${file.fileId}`).set(headers),
      request(app).patch(`/api/v1/files/${file.fileId}`).set(headers).send({ name: "no.txt" }),
      request(app)
        .post(`/api/v1/files/${file.fileId}/move`)
        .set(headers)
        .send({ folderId: owner.rootFolderId }),
      request(app).delete(`/api/v1/files/${file.fileId}`).set(headers),
      request(app).get(`/api/v1/files/${file.fileId}/download`).set(headers),
      request(app).get(`/api/v1/files/${file.fileId}/versions`).set(headers),
      request(app)
        .post(`/api/v1/files/${file.fileId}/versions/${file.versionId}/restore`)
        .set(headers),
      request(app).post("/api/v1/uploads/start").set(headers).send({
        uploadMode: "new_version",
        targetFileId: file.fileId,
        mimeType: "text/plain",
        totalSizeBytes: "4",
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(404));
    expect(responses.map((response) => response.body.error.code)).toEqual(
      Array(8).fill("file_not_found"),
    );
  });

  it("grants viewer read/download access, denies mutations, and revokes access", async () => {
    const owner = await ensureUser("direct-owner");
    const recipient = await ensureUser("direct-recipient");
    const file = await createAvailableFile(owner, "direct-share.txt");
    const created = await request(app)
      .post("/api/v1/shares")
      .set(authHeaders("direct-owner"))
      .send({
        resourceType: "file",
        resourceId: file.fileId,
        granteeEmail: recipient.email,
        role: "viewer",
      })
      .expect(201);

    await request(app)
      .get(`/api/v1/files/${file.fileId}`)
      .set(authHeaders("direct-recipient"))
      .expect(200);
    await request(app)
      .get(`/api/v1/files/${file.fileId}/download`)
      .set(authHeaders("direct-recipient"))
      .expect(200);
    await request(app)
      .get(`/api/v1/files/${file.fileId}/versions`)
      .set(authHeaders("direct-recipient"))
      .expect(200);
    await request(app)
      .patch(`/api/v1/files/${file.fileId}`)
      .set(authHeaders("direct-recipient"))
      .send({ name: "forbidden.txt" })
      .expect(404);
    await request(app)
      .post(`/api/v1/files/${file.fileId}/versions/${file.versionId}/restore`)
      .set(authHeaders("direct-recipient"))
      .expect(404);
    await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders("direct-recipient"))
      .send({
        uploadMode: "new_version",
        targetFileId: file.fileId,
        mimeType: "text/plain",
        totalSizeBytes: "4",
      })
      .expect(404);

    const listed = await request(app)
      .get(`/api/v1/resources/file/${file.fileId}/shares`)
      .set(authHeaders("direct-owner"))
      .expect(200);
    expect(listed.body.data.shares).toHaveLength(1);
    await request(app)
      .get(`/api/v1/resources/file/${file.fileId}/shares`)
      .set(authHeaders("direct-recipient"))
      .expect(404);

    await request(app)
      .delete(`/api/v1/shares/${created.body.data.id}`)
      .set(authHeaders("direct-recipient"))
      .expect(404);
    await request(app)
      .delete(`/api/v1/shares/${created.body.data.id}`)
      .set(authHeaders("direct-owner"))
      .expect(200);
    await request(app)
      .get(`/api/v1/files/${file.fileId}`)
      .set(authHeaders("direct-recipient"))
      .expect(404);

    const audits = await prisma.auditLog.findMany({ where: { actorUserId: owner.id } });
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(["share.created", "share.revoked"]),
    );
  });

  it("allows editor version and metadata actions but not share management", async () => {
    const owner = await ensureUser("editor-owner");
    const editor = await ensureUser("editor-recipient");
    const file = await createAvailableFile(owner, "editor.txt");
    await request(app)
      .post("/api/v1/shares")
      .set(authHeaders("editor-owner"))
      .send({
        resourceType: "file",
        resourceId: file.fileId,
        granteeEmail: editor.email,
        role: "editor",
      })
      .expect(201);

    await request(app)
      .patch(`/api/v1/files/${file.fileId}`)
      .set(authHeaders("editor-recipient"))
      .send({ name: "edited.txt" })
      .expect(200);
    await request(app)
      .post(`/api/v1/files/${file.fileId}/versions/${file.versionId}/restore`)
      .set(authHeaders("editor-recipient"))
      .expect(200);
    const versionUpload = await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders("editor-recipient"))
      .send({
        uploadMode: "new_version",
        targetFileId: file.fileId,
        mimeType: "text/plain",
        totalSizeBytes: "4",
      })
      .expect(201);
    await request(app)
      .post("/api/v1/shares")
      .set(authHeaders("editor-recipient"))
      .send({
        resourceType: "file",
        resourceId: file.fileId,
        granteeEmail: `${runId}-unused@nimbus.test`,
        role: "viewer",
      })
      .expect(404);
    await request(app)
      .delete(`/api/v1/files/${file.fileId}`)
      .set(authHeaders("editor-recipient"))
      .expect(200);
    expect(versionUpload.body.data.uploadMode).toBe("new_version");
  });

  it("blocks every new-version session operation after editor revocation", async () => {
    const owner = await ensureUser("session-owner");
    const editor = await ensureUser("session-editor");
    const file = await createAvailableFile(owner, "session.txt");
    const share = await request(app)
      .post("/api/v1/shares")
      .set(authHeaders("session-owner"))
      .send({
        resourceType: "file",
        resourceId: file.fileId,
        granteeEmail: editor.email,
        role: "editor",
      })
      .expect(201);
    const upload = await request(app)
      .post("/api/v1/uploads/start")
      .set(authHeaders("session-editor"))
      .send({
        uploadMode: "new_version",
        targetFileId: file.fileId,
        mimeType: "text/plain",
        totalSizeBytes: "4",
      })
      .expect(201);
    const uploadSessionId = upload.body.data.uploadSessionId as string;

    await request(app)
      .delete(`/api/v1/shares/${share.body.data.id}`)
      .set(authHeaders("session-owner"))
      .expect(200);

    const responses = await Promise.all([
      request(app).get(`/api/v1/uploads/${uploadSessionId}`).set(authHeaders("session-editor")),
      request(app)
        .get(`/api/v1/uploads/${uploadSessionId}/chunks`)
        .set(authHeaders("session-editor")),
      request(app)
        .post(`/api/v1/uploads/${uploadSessionId}/chunks`)
        .set(authHeaders("session-editor"))
        .send({ partNumber: 1, etag: "etag", sizeBytes: "4" }),
      request(app)
        .post(`/api/v1/uploads/${uploadSessionId}/complete`)
        .set(authHeaders("session-editor")),
      request(app)
        .post(`/api/v1/uploads/${uploadSessionId}/cancel`)
        .set(authHeaders("session-editor")),
      request(app).post("/api/v1/uploads/start").set(authHeaders("session-editor")).send({
        uploadMode: "new_version",
        targetFileId: file.fileId,
        mimeType: "text/plain",
        totalSizeBytes: "4",
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(404));
    expect(responses.map((response) => response.body.error.code)).toEqual(
      Array(6).fill("file_not_found"),
    );
    await expect(
      prisma.uploadSession.findUniqueOrThrow({ where: { id: uploadSessionId } }),
    ).resolves.toMatchObject({ status: "created" });
  });

  it("creates hashed public links, exposes only scoped data, and blocks revoked tokens", async () => {
    const owner = await ensureUser("public-owner");
    const intruder = await ensureUser("public-intruder");
    const sharedFile = await createAvailableFile(owner, "public.txt");
    const unrelatedFile = await createAvailableFile(owner, "private.txt");
    const backgroundJob = await prisma.backgroundJob.create({
      data: {
        ownerId: owner.id,
        queueName: "test-public-metadata",
        resourceType: "upload_session",
        resourceId: sharedFile.uploadSessionId,
        status: "succeeded",
      },
    });
    const created = await request(app)
      .post("/api/v1/share-links")
      .set(authHeaders("public-owner"))
      .send({ resourceType: "file", resourceId: sharedFile.fileId })
      .expect(201);
    const rawToken = created.body.data.token as string;
    const shareLinkId = created.body.data.shareLink.id as string;
    const persisted = await prisma.shareLink.findUniqueOrThrow({ where: { id: shareLinkId } });

    expect(persisted.tokenHash).toBe(hashShareLinkToken(rawToken));
    expect(JSON.stringify(persisted)).not.toContain(rawToken);

    const managed = await request(app)
      .get(`/api/v1/share-links/${shareLinkId}`)
      .set(authHeaders("public-owner"))
      .expect(200);
    expect(JSON.stringify(managed.body)).not.toContain(rawToken);
    expect(JSON.stringify(managed.body)).not.toContain(persisted.tokenHash);
    await request(app)
      .get(`/api/v1/share-links/${shareLinkId}`)
      .set(authHeaders("public-intruder"))
      .expect(404);
    await request(app)
      .delete(`/api/v1/share-links/${shareLinkId}`)
      .set(authHeaders("public-intruder"))
      .expect(404);
    expect(intruder.id).not.toBe(owner.id);

    const publicMetadata = await request(app).get(`/api/v1/public/${rawToken}`).expect(200);
    expect(publicMetadata.body.data).toEqual({
      resource: {
        resourceType: "file",
        resourceId: sharedFile.fileId,
        name: "public.txt",
        mimeType: "text/plain",
        sizeBytes: "12",
        updatedAt: expect.any(String),
      },
    });
    const metadataJson = JSON.stringify(publicMetadata.body);
    for (const forbiddenValue of [
      rawToken,
      persisted.tokenHash,
      sharedFile.objectKey,
      sharedFile.bucket,
      sharedFile.uploadSessionId,
      backgroundJob.id,
      owner.rootFolderId,
      owner.email,
      unrelatedFile.fileId,
      unrelatedFile.versionId,
    ]) {
      expect(metadataJson).not.toContain(forbiddenValue);
    }
    for (const forbiddenKey of [
      "tokenHash",
      "token",
      "objectKey",
      "bucket",
      "uploadSessionId",
      "backgroundJobId",
      "folderId",
      "ownerId",
      "ownerEmail",
    ]) {
      expect(metadataJson).not.toContain(forbiddenKey);
    }
    expect(publicMetadata.body.data).not.toHaveProperty("download");

    const publicDownload = await request(app)
      .get(`/api/v1/public/${rawToken}`)
      .query({ download: "true" })
      .expect(200);
    expect(publicDownload.body.data.resource.resourceId).toBe(sharedFile.fileId);
    expect(publicDownload.body.data.download.url).toContain(
      encodeURIComponent(sharedFile.versionId),
    );
    expect(publicDownload.body.data.download.url).not.toContain(unrelatedFile.versionId);

    const useCountBeforeRevocation = (
      await prisma.shareLink.findUniqueOrThrow({ where: { id: shareLinkId } })
    ).useCount;
    await request(app)
      .delete(`/api/v1/share-links/${shareLinkId}`)
      .set(authHeaders("public-owner"))
      .expect(200);
    await request(app).get(`/api/v1/public/${rawToken}`).expect(404);
    expect(
      (await prisma.shareLink.findUniqueOrThrow({ where: { id: shareLinkId } })).useCount,
    ).toBe(useCountBeforeRevocation);

    const expiring = await request(app)
      .post("/api/v1/share-links")
      .set(authHeaders("public-owner"))
      .send({ resourceType: "file", resourceId: sharedFile.fileId })
      .expect(201);
    await prisma.shareLink.update({
      where: { id: expiring.body.data.shareLink.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await request(app)
      .get(`/api/v1/public/${expiring.body.data.token}`)
      .query({ download: "true" })
      .expect(404);
    expect(
      (
        await prisma.shareLink.findUniqueOrThrow({
          where: { id: expiring.body.data.shareLink.id },
        })
      ).useCount,
    ).toBe(0);

    const audits = await prisma.auditLog.findMany({ where: { actorUserId: owner.id } });
    const auditJson = JSON.stringify(audits);
    expect(audits.map((audit) => audit.action)).toEqual(
      expect.arrayContaining(["share_link.created", "share_link.accessed", "share_link.revoked"]),
    );
    expect(auditJson).not.toContain(rawToken);
    expect(auditJson).not.toContain(publicDownload.body.data.download.url);
    expect(auditJson).not.toContain("signature=fake");
    const jobs = await prisma.backgroundJob.findMany({
      where: { resourceId: { in: [sharedFile.uploadSessionId, unrelatedFile.uploadSessionId] } },
    });
    expect(JSON.stringify(jobs)).not.toContain(rawToken);
    expect(JSON.stringify(jobs)).not.toContain(publicDownload.body.data.download.url);
  });

  it("redacts raw public tokens from request logger output", async () => {
    const owner = await ensureUser("logger-owner");
    const file = await createAvailableFile(owner, "logger.txt");
    const created = await request(app)
      .post("/api/v1/share-links")
      .set(authHeaders("logger-owner"))
      .send({ resourceType: "file", resourceId: file.fileId })
      .expect(201);
    const rawToken = created.body.data.token as string;
    const lines: string[] = [];
    const loggedApp = createApp({
      config: testConfig,
      readinessChecker: async () => ({ postgres: true, redis: true }),
      storageProvider: storage,
      uploadFinalizationQueue: {
        enqueueUploadFinalization: async () => ({ bullmqJobId: "unused" }),
      },
      m8JobScheduler,
      logger: createLogger({ service: "sharing-logger-test", sink: (line) => lines.push(line) }),
    });

    await request(loggedApp).get(`/api/v1/public/${rawToken}`).expect(200);
    const output = lines.join("\n");
    expect(output).not.toContain(rawToken);
    expect(output).toContain("[REDACTED]");
  });

  it("allows current direct viewers to sign thumbnails and blocks revoked/public access", async () => {
    const owner = await ensureUser("thumbnail-owner");
    const viewer = await ensureUser("thumbnail-viewer");
    const file = await createAvailableFile(owner, "thumbnail.png");
    const thumbnailObjectKey = `objects/${owner.id}/${file.fileId}/versions/${file.versionId}/derived/thumbnail.webp`;
    await prisma.thumbnail.create({
      data: {
        ownerId: owner.id,
        fileId: file.fileId,
        fileVersionId: file.versionId,
        status: "complete",
        bucket: "nimbus-test",
        objectKey: thumbnailObjectKey,
        width: 120,
        height: 80,
        sizeBytes: 3n,
        completedAt: new Date(),
      },
    });
    const share = await request(app)
      .post("/api/v1/shares")
      .set(authHeaders("thumbnail-owner"))
      .send({
        resourceType: "file",
        resourceId: file.fileId,
        granteeEmail: viewer.email,
        role: "viewer",
      })
      .expect(201);

    const thumbnail = await request(app)
      .get(`/api/v1/files/${file.fileId}/thumbnail`)
      .set(authHeaders("thumbnail-viewer"))
      .expect(200);
    expect(thumbnail.body.data).toMatchObject({
      fileId: file.fileId,
      fileVersionId: file.versionId,
      mimeType: "image/webp",
      width: 120,
      height: 80,
      sizeBytes: "3",
    });

    const publicLink = await request(app)
      .post("/api/v1/share-links")
      .set(authHeaders("thumbnail-owner"))
      .send({ resourceType: "file", resourceId: file.fileId })
      .expect(201);
    const publicMetadata = await request(app)
      .get(`/api/v1/public/${publicLink.body.data.token}`)
      .expect(200);
    expect(publicMetadata.body.data).not.toHaveProperty("thumbnail");

    await request(app)
      .delete(`/api/v1/shares/${share.body.data.id}`)
      .set(authHeaders("thumbnail-owner"))
      .expect(200);
    await request(app)
      .get(`/api/v1/files/${file.fileId}/thumbnail`)
      .set(authHeaders("thumbnail-viewer"))
      .expect(404);
  });
});
