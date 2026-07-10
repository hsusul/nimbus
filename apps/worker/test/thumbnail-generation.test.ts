import { THUMBNAIL_GENERATION_QUEUE_NAME } from "@nimbus/contracts";
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
  PutObjectInput,
  SignedDownloadUrlInput,
  SignedPartUploadUrlInput,
  SignedUploadUrlInput,
  SignedUrl,
} from "@nimbus/storage";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  generateThumbnail,
  type ThumbnailImageProcessor,
  type ThumbnailLimits,
} from "../src/jobs/thumbnail-generation";

class ThumbnailStorage implements ObjectStorageProvider {
  readonly objects = new Map<string, Uint8Array>();
  reads = 0;
  writes = 0;

  async readObject(input: ObjectLocation): Promise<Uint8Array> {
    this.reads += 1;
    return this.objects.get(key(input)) ?? new Uint8Array([1, 2, 3]);
  }

  async writeObject(input: PutObjectInput): Promise<ObjectMetadata> {
    this.writes += 1;
    this.objects.set(key(input), input.body);
    return {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: BigInt(input.body.byteLength),
      etag: "thumbnail-etag",
      contentType: input.contentType,
      metadata: {},
    };
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
  async abortMultipartUpload(_input: AbortMultipartUploadInput): Promise<void> {}
  async headObject(input: ObjectLocation): Promise<ObjectMetadata> {
    return {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: 3n,
      etag: null,
      contentType: null,
      metadata: {},
    };
  }
  async deleteObject(_input: ObjectLocation): Promise<void> {}
}

const prisma = getPrismaClient();
const storage = new ThumbnailStorage();
const runId = `m8-thumb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const limits: ThumbnailLimits = {
  maxInputBytes: 1024 * 1024,
  maxPixelCount: 1_000_000,
  maxWidth: 2000,
  maxHeight: 2000,
  outputWidth: 320,
  outputHeight: 320,
  processingTimeoutMs: 5000,
};
const fakeProcessor: ThumbnailImageProcessor = {
  createThumbnail: async () => ({ bytes: new Uint8Array([9, 8, 7]), width: 120, height: 80 }),
};

async function createFixture(slug: string, mimeType: string, sizeBytes = 3n) {
  const user = await prisma.user.create({
    data: { authSubject: `${runId}-${slug}`, email: `${slug}@${runId}.nimbus.test` },
  });
  const folder = await prisma.folder.create({
    data: { ownerId: user.id, name: "Root", normalizedName: "root", depth: 0 },
  });
  const file = await prisma.file.create({
    data: {
      ownerId: user.id,
      folderId: folder.id,
      name: `${slug}.image`,
      normalizedName: `${slug}.image`,
      mimeType,
      status: "active",
      sizeBytes,
    },
  });
  const versionId = randomUUID();
  const objectKey = `objects/${user.id}/${file.id}/versions/${versionId}/content`;
  const upload = await prisma.uploadSession.create({
    data: {
      ownerId: user.id,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId: versionId,
      filename: file.name,
      mimeType,
      totalSizeBytes: sizeBytes,
      finalObjectKey: objectKey,
      bucket: "nimbus-test",
      status: "completed",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const version = await prisma.fileVersion.create({
    data: {
      id: versionId,
      fileId: file.id,
      versionNumber: 1,
      storageProvider: "s3-compatible",
      bucket: "nimbus-test",
      objectKey,
      sizeBytes,
      mimeType,
      uploadSessionId: upload.id,
      createdById: user.id,
      processingStatus: "available",
    },
  });
  await prisma.file.update({ where: { id: file.id }, data: { currentVersionId: version.id } });
  const job = await prisma.backgroundJob.create({
    data: {
      ownerId: user.id,
      queueName: THUMBNAIL_GENERATION_QUEUE_NAME,
      resourceType: "file_version",
      resourceId: version.id,
      status: "queued",
    },
  });
  return { user, file, version, job, objectKey };
}

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${runId}.nimbus.test` } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (!ids.length) return;
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

describe.sequential("thumbnail generation worker", () => {
  for (const mimeType of ["image/jpeg", "image/png", "image/webp"]) {
    it(`generates one deterministic WebP thumbnail for ${mimeType}`, async () => {
      const fixture = await createFixture(mimeType.replace("/", "-"), mimeType);
      await generateThumbnail(
        { fileVersionId: fixture.version.id, backgroundJobId: fixture.job.id },
        { prisma, storage, limits, imageProcessor: fakeProcessor },
      );
      await generateThumbnail(
        { fileVersionId: fixture.version.id, backgroundJobId: fixture.job.id },
        { prisma, storage, limits, imageProcessor: fakeProcessor },
      );

      const thumbnail = await prisma.thumbnail.findUniqueOrThrow({
        where: { fileVersionId: fixture.version.id },
      });
      expect(thumbnail).toMatchObject({
        status: "complete",
        mimeType: "image/webp",
        width: 120,
        height: 80,
      });
      expect(thumbnail.objectKey).toBe(
        `objects/${fixture.user.id}/${fixture.file.id}/versions/${fixture.version.id}/derived/thumbnail.webp`,
      );
      expect(await prisma.thumbnail.count({ where: { fileVersionId: fixture.version.id } })).toBe(
        1,
      );
    });
  }

  it("skips unsupported and unavailable sources", async () => {
    const unsupported = await createFixture("unsupported", "application/pdf");
    await generateThumbnail(
      { fileVersionId: unsupported.version.id, backgroundJobId: unsupported.job.id },
      { prisma, storage, limits, imageProcessor: fakeProcessor },
    );
    await expect(
      prisma.thumbnail.findUniqueOrThrow({ where: { fileVersionId: unsupported.version.id } }),
    ).resolves.toMatchObject({ status: "skipped", failureCode: "unsupported_mime_type" });

    const deleted = await createFixture("deleted", "image/png");
    await prisma.file.update({
      where: { id: deleted.file.id },
      data: { status: "deleted", deletedAt: new Date() },
    });
    await generateThumbnail(
      { fileVersionId: deleted.version.id, backgroundJobId: deleted.job.id },
      { prisma, storage, limits, imageProcessor: fakeProcessor },
    );
    await expect(
      prisma.thumbnail.findUniqueOrThrow({ where: { fileVersionId: deleted.version.id } }),
    ).resolves.toMatchObject({ status: "skipped", failureCode: "thumbnail_source_unavailable" });
  });

  it("fails safely on input-size and decoded-pixel limits", async () => {
    const tooLarge = await createFixture(
      "too-large",
      "image/png",
      BigInt(limits.maxInputBytes + 1),
    );
    await generateThumbnail(
      { fileVersionId: tooLarge.version.id, backgroundJobId: tooLarge.job.id },
      { prisma, storage, limits, imageProcessor: fakeProcessor },
    );
    await expect(
      prisma.thumbnail.findUniqueOrThrow({ where: { fileVersionId: tooLarge.version.id } }),
    ).resolves.toMatchObject({ status: "failed", failureCode: "thumbnail_input_too_large" });

    const pixels = await createFixture("pixels", "image/png");
    storage.objects.set(
      key({ bucket: "nimbus-test", objectKey: pixels.objectKey }),
      await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } })
        .png()
        .toBuffer(),
    );
    await generateThumbnail(
      { fileVersionId: pixels.version.id, backgroundJobId: pixels.job.id },
      { prisma, storage, limits: { ...limits, maxPixelCount: 100 } },
    );
    await expect(
      prisma.thumbnail.findUniqueOrThrow({ where: { fileVersionId: pixels.version.id } }),
    ).resolves.toMatchObject({ status: "failed", failureCode: "thumbnail_processing_failed" });
  });
});

function key(input: ObjectLocation) {
  return `${input.bucket}/${input.objectKey}`;
}
