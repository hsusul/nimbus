import { OBJECT_CLEANUP_QUEUE_NAME } from "@nimbus/contracts";
import { getPrismaClient } from "@nimbus/db";
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanupUploadArtifacts } from "../src/jobs/object-cleanup";

class CleanupStorage implements ObjectStorageProvider {
  readonly objects = new Set<string>();
  readonly aborted: AbortMultipartUploadInput[] = [];
  failDelete: Error | null = null;
  abortAsMissing = false;

  async abortMultipartUpload(input: AbortMultipartUploadInput): Promise<void> {
    if (this.abortAsMissing) {
      const error = new Error("NoSuchUpload");
      error.name = "NoSuchUpload";
      throw error;
    }
    this.aborted.push(input);
  }

  async deleteObject(input: ObjectLocation): Promise<void> {
    if (this.failDelete) {
      const error = this.failDelete;
      this.failDelete = null;
      throw error;
    }
    if (!this.objects.delete(key(input)))
      throw new ObjectNotFoundError(input.bucket, input.objectKey);
  }

  async createSignedUploadUrl(_input: SignedUploadUrlInput): Promise<SignedUrl> {
    throw new Error("unused");
  }
  async createSignedDownloadUrl(_input: SignedDownloadUrlInput): Promise<SignedUrl> {
    throw new Error("unused");
  }
  async createMultipartUpload(
    _input: CreateMultipartUploadInput,
  ): Promise<CreateMultipartUploadResult> {
    throw new Error("unused");
  }
  async createSignedPartUploadUrl(_input: SignedPartUploadUrlInput): Promise<SignedUrl> {
    throw new Error("unused");
  }
  async completeMultipartUpload(
    _input: CompleteMultipartUploadInput,
  ): Promise<CompleteMultipartUploadResult> {
    throw new Error("unused");
  }
  async headObject(input: ObjectLocation): Promise<ObjectMetadata> {
    if (!this.objects.has(key(input))) throw new ObjectNotFoundError(input.bucket, input.objectKey);
    return {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: 1n,
      etag: null,
      contentType: null,
      metadata: {},
    };
  }
}

const prisma = getPrismaClient();
const storage = new CleanupStorage();
const runId = `m8-cleanup-${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function createFixture(
  slug: string,
  status: string,
  options: { multipart?: boolean; sessionOwnerId?: string } = {},
) {
  const owner = await prisma.user.create({
    data: { authSubject: `${runId}-${slug}`, email: `${slug}@${runId}.nimbus.test` },
  });
  const folder = await prisma.folder.create({
    data: { ownerId: owner.id, name: "Root", normalizedName: "root", depth: 0 },
  });
  const file = await prisma.file.create({
    data: {
      ownerId: owner.id,
      folderId: folder.id,
      name: `${slug}.bin`,
      normalizedName: `${slug}.bin`,
      status: status === "failed" ? "failed" : "active",
    },
  });
  const sessionOwnerId = options.sessionOwnerId ?? owner.id;
  const sessionId = randomUUID();
  const objectKey = `objects/${owner.id}/${file.id}/versions/${randomUUID()}/content`;
  const session = await prisma.uploadSession.create({
    data: {
      id: sessionId,
      ownerId: sessionOwnerId,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId: randomUUID(),
      filename: file.name,
      mimeType: "application/octet-stream",
      totalSizeBytes: 1n,
      finalObjectKey: objectKey,
      bucket: "nimbus-test",
      uploadType: options.multipart ? "multipart" : "single_part",
      multipartUploadId: options.multipart ? `multipart-${sessionId}` : null,
      chunkSizeBytes: options.multipart ? 5n : null,
      status,
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const job = await prisma.backgroundJob.create({
    data: {
      ownerId: sessionOwnerId,
      queueName: OBJECT_CLEANUP_QUEUE_NAME,
      resourceType: "upload_session",
      resourceId: session.id,
      status: "queued",
    },
  });
  storage.objects.add(key({ bucket: session.bucket, objectKey }));
  return { owner, folder, file, session, job, objectKey };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${runId}.nimbus.test` } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (!ids.length) return;
  await prisma.share.deleteMany({
    where: { OR: [{ createdById: { in: ids } }, { granteeUserId: { in: ids } }] },
  });
  await prisma.thumbnail.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.backgroundJob.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.fileVersion.deleteMany({ where: { createdById: { in: ids } } });
  await prisma.uploadSession.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.file.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.folder.deleteMany({ where: { ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(cleanup);
afterAll(cleanup);

describe.sequential("object cleanup worker", () => {
  for (const status of ["expired", "failed", "canceled"]) {
    it(`aborts and deletes orphaned ${status} multipart artifacts idempotently`, async () => {
      const fixture = await createFixture(`multipart-${status}`, status, { multipart: true });
      await cleanupUploadArtifacts(
        { uploadSessionId: fixture.session.id, backgroundJobId: fixture.job.id },
        { prisma, storage },
      );
      storage.abortAsMissing = true;
      await cleanupUploadArtifacts(
        { uploadSessionId: fixture.session.id, backgroundJobId: fixture.job.id },
        { prisma, storage },
      );
      storage.abortAsMissing = false;

      expect(
        storage.objects.has(key({ bucket: fixture.session.bucket, objectKey: fixture.objectKey })),
      ).toBe(false);
      expect(
        storage.aborted.some((abort) => abort.uploadId === fixture.session.multipartUploadId),
      ).toBe(true);
      await expect(
        prisma.backgroundJob.findUniqueOrThrow({ where: { id: fixture.job.id } }),
      ).resolves.toMatchObject({ status: "succeeded" });
    });
  }

  it("skips active-version, live-upload, and completing-upload objects", async () => {
    const referenced = await createFixture("referenced", "failed");
    const version = await prisma.fileVersion.create({
      data: {
        fileId: referenced.file.id,
        versionNumber: 1,
        storageProvider: "s3-compatible",
        bucket: referenced.session.bucket,
        objectKey: referenced.objectKey,
        sizeBytes: 1n,
        mimeType: "application/octet-stream",
        uploadSessionId: referenced.session.id,
        createdById: referenced.owner.id,
        processingStatus: "available",
      },
    });
    await prisma.file.update({
      where: { id: referenced.file.id },
      data: { currentVersionId: version.id, status: "active" },
    });
    await prisma.fileVersion.update({
      where: { id: version.id },
      data: { processingStatus: "failed" },
    });
    await cleanupUploadArtifacts(
      { uploadSessionId: referenced.session.id, backgroundJobId: referenced.job.id },
      { prisma, storage },
    );
    expect(
      storage.objects.has(
        key({ bucket: referenced.session.bucket, objectKey: referenced.objectKey }),
      ),
    ).toBe(true);

    for (const liveStatus of ["created", "uploading", "completing"]) {
      const live = await createFixture(`live-${liveStatus}`, liveStatus);
      await cleanupUploadArtifacts(
        { uploadSessionId: live.session.id, backgroundJobId: live.job.id },
        { prisma, storage },
      );
      expect(
        storage.objects.has(key({ bucket: live.session.bucket, objectKey: live.objectKey })),
      ).toBe(true);
    }
  });

  it("runs as a system operation after editor revocation and handles missing objects", async () => {
    const editor = await prisma.user.create({
      data: { authSubject: `${runId}-editor`, email: `editor@${runId}.nimbus.test` },
    });
    const fixture = await createFixture("revoked-editor", "canceled", {
      sessionOwnerId: editor.id,
    });
    const share = await prisma.share.create({
      data: {
        resourceType: "file",
        resourceId: fixture.file.id,
        granteeUserId: editor.id,
        role: "editor",
        createdById: fixture.owner.id,
        revokedAt: new Date(),
      },
    });
    storage.objects.delete(key({ bucket: fixture.session.bucket, objectKey: fixture.objectKey }));

    await cleanupUploadArtifacts(
      { uploadSessionId: fixture.session.id, backgroundJobId: fixture.job.id },
      { prisma, storage },
    );
    expect(share.revokedAt).not.toBeNull();
    await expect(
      prisma.backgroundJob.findUniqueOrThrow({ where: { id: fixture.job.id } }),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("records sanitized failure and rethrows transient storage errors", async () => {
    const fixture = await createFixture("transient", "failed");
    storage.failDelete = new Error("private provider detail");
    await expect(
      cleanupUploadArtifacts(
        { uploadSessionId: fixture.session.id, backgroundJobId: fixture.job.id },
        { prisma, storage },
      ),
    ).rejects.toThrow("private provider detail");
    await expect(
      prisma.backgroundJob.findUniqueOrThrow({ where: { id: fixture.job.id } }),
    ).resolves.toMatchObject({
      status: "failed",
      failureCode: "object_cleanup_storage_failed",
      lastError: "object_cleanup_storage_failed",
    });
  });
});

function key(input: ObjectLocation) {
  return `${input.bucket}/${input.objectKey}`;
}
