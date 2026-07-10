import { UPLOAD_FINALIZATION_QUEUE_NAME } from "@nimbus/contracts";
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

import { finalizeUploadSession } from "../src/jobs/upload-finalization";

class FakeObjectStorageProvider implements ObjectStorageProvider {
  private readonly objects = new Map<string, ObjectMetadata>();
  private readonly multipartObjects = new Map<string, ObjectMetadata>();
  private transientError: Error | null = null;
  readonly completedMultipartUploads: CompleteMultipartUploadInput[] = [];

  async createSignedUploadUrl(_input: SignedUploadUrlInput): Promise<SignedUrl> {
    throw new Error("not implemented");
  }

  async createSignedDownloadUrl(_input: SignedDownloadUrlInput): Promise<SignedUrl> {
    throw new Error("not implemented");
  }

  async createMultipartUpload(
    _input: CreateMultipartUploadInput,
  ): Promise<CreateMultipartUploadResult> {
    throw new Error("not implemented");
  }

  async createSignedPartUploadUrl(_input: SignedPartUploadUrlInput): Promise<SignedUrl> {
    throw new Error("not implemented");
  }

  async completeMultipartUpload(
    input: CompleteMultipartUploadInput,
  ): Promise<CompleteMultipartUploadResult> {
    if (this.transientError) {
      const error = this.transientError;
      this.transientError = null;
      throw error;
    }

    this.completedMultipartUploads.push(input);
    const object = this.multipartObjects.get(toObjectMapKey(input));

    if (object) {
      this.objects.set(toObjectMapKey(input), object);
    }

    return {
      etag: object?.etag ?? "fake-multipart-etag",
    };
  }

  async abortMultipartUpload(_input: AbortMultipartUploadInput): Promise<void> {
    throw new Error("not implemented");
  }

  async headObject(input: ObjectLocation): Promise<ObjectMetadata> {
    if (this.transientError) {
      const error = this.transientError;
      this.transientError = null;
      throw error;
    }

    const object = this.objects.get(toObjectMapKey(input));

    if (!object) {
      throw new ObjectNotFoundError(input.bucket, input.objectKey);
    }

    return object;
  }

  async deleteObject(input: ObjectLocation): Promise<void> {
    this.objects.delete(toObjectMapKey(input));
  }

  putObject(input: ObjectLocation & { sizeBytes: bigint; contentType: string; sha256?: string }) {
    this.objects.set(toObjectMapKey(input), {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
      etag: "fake-etag",
      contentType: input.contentType,
      metadata: input.sha256 ? { sha256: input.sha256 } : {},
    });
  }

  stageMultipartObject(
    input: ObjectLocation & { sizeBytes: bigint; contentType: string; sha256?: string },
  ) {
    this.multipartObjects.set(toObjectMapKey(input), {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: input.sizeBytes,
      etag: "fake-multipart-etag",
      contentType: input.contentType,
      metadata: input.sha256 ? { sha256: input.sha256 } : {},
    });
  }

  failNextHeadObject(error: Error) {
    this.transientError = error;
  }
}

const prisma = getPrismaClient();
const storage = new FakeObjectStorageProvider();
const runId = `m4-worker-${Date.now()}-${Math.random().toString(16).slice(2)}`;

interface UploadFixture {
  userId: string;
  fileId: string;
  uploadSessionId: string;
  backgroundJobId: string;
  plannedVersionId: string;
  objectKey: string;
}

interface NewVersionUploadFixture extends UploadFixture {
  folderId: string;
  previousVersionId: string;
  previousSizeBytes: bigint;
  previousMimeType: string;
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

describe.sequential("upload finalization worker", () => {
  it("finalizes a completing upload and writes version, state, job, and audit records", async () => {
    const fixture = await createUploadFixture("success", {
      expectedSha256: "sha-success",
      totalSizeBytes: 12n,
    });

    storage.putObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 12n,
      contentType: "text/plain",
      sha256: "sha-success",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-success",
      },
      { prisma, storage },
    );

    const [file, uploadSession, backgroundJob, versions, auditLogs] = await Promise.all([
      prisma.file.findUniqueOrThrow({
        where: {
          id: fixture.fileId,
        },
      }),
      prisma.uploadSession.findUniqueOrThrow({
        where: {
          id: fixture.uploadSessionId,
        },
      }),
      prisma.backgroundJob.findUniqueOrThrow({
        where: {
          id: fixture.backgroundJobId,
        },
      }),
      prisma.fileVersion.findMany({
        where: {
          uploadSessionId: fixture.uploadSessionId,
        },
      }),
      prisma.auditLog.findMany({
        where: {
          actorUserId: fixture.userId,
          action: "upload.completed",
        },
      }),
    ]);

    expect(file).toMatchObject({
      status: "active",
      currentVersionId: fixture.plannedVersionId,
      contentHash: "sha-success",
    });
    expect(file.sizeBytes).toBe(12n);
    expect(uploadSession).toMatchObject({
      status: "completed",
      failureReason: null,
      correlationId: "corr-success",
    });
    expect(uploadSession.completedAt).toBeInstanceOf(Date);
    expect(backgroundJob).toMatchObject({
      status: "succeeded",
      lastError: null,
      correlationId: "corr-success",
    });
    expect(backgroundJob.attempts).toBe(1);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      id: fixture.plannedVersionId,
      fileId: fixture.fileId,
      versionNumber: 1,
      objectKey: fixture.objectKey,
      processingStatus: "available",
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      resourceType: "file",
      resourceId: fixture.fileId,
      requestId: "corr-success",
      correlationId: "corr-success",
    });
    expect(JSON.stringify(auditLogs[0])).not.toContain(fixture.objectKey);
  });

  it("does not create duplicate file versions on duplicate worker execution", async () => {
    const fixture = await createUploadFixture("duplicate", {
      totalSizeBytes: 5n,
    });

    storage.putObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 5n,
      contentType: "text/plain",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-duplicate",
      },
      { prisma, storage },
    );
    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-duplicate",
      },
      { prisma, storage },
    );

    const versionCount = await prisma.fileVersion.count({
      where: {
        uploadSessionId: fixture.uploadSessionId,
      },
    });
    const file = await prisma.file.findUniqueOrThrow({
      where: {
        id: fixture.fileId,
      },
    });

    expect(versionCount).toBe(1);
    expect(file.currentVersionId).toBe(fixture.plannedVersionId);
  });

  it("finalizes a single-part new_version upload for an existing active file", async () => {
    const fixture = await createNewVersionUploadFixture("new-version-success", {
      totalSizeBytes: 9n,
      mimeType: "text/markdown",
      expectedSha256: "sha-new-version",
    });

    storage.putObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 9n,
      contentType: "text/markdown",
      sha256: "sha-new-version",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-new-version-success",
      },
      { prisma, storage },
    );

    const [file, versions, auditLog, uploadSession] = await Promise.all([
      prisma.file.findUniqueOrThrow({
        where: {
          id: fixture.fileId,
        },
      }),
      prisma.fileVersion.findMany({
        where: {
          fileId: fixture.fileId,
        },
        orderBy: {
          versionNumber: "asc",
        },
      }),
      prisma.auditLog.findFirstOrThrow({
        where: {
          actorUserId: fixture.userId,
          action: "file.version_uploaded",
        },
      }),
      prisma.uploadSession.findUniqueOrThrow({
        where: {
          id: fixture.uploadSessionId,
        },
      }),
    ]);

    expect(file).toMatchObject({
      status: "active",
      folderId: fixture.folderId,
      name: "new-version-success.txt",
      currentVersionId: fixture.plannedVersionId,
      mimeType: "text/markdown",
      contentHash: "sha-new-version",
    });
    expect(file.sizeBytes).toBe(9n);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
    expect(versions[1]).toMatchObject({
      id: fixture.plannedVersionId,
      uploadSessionId: fixture.uploadSessionId,
      processingStatus: "available",
    });
    expect(uploadSession.status).toBe("completed");
    expect(auditLog).toMatchObject({
      resourceType: "file",
      resourceId: fixture.fileId,
      requestId: "corr-new-version-success",
    });
    expect(JSON.stringify(auditLog)).not.toContain(fixture.objectKey);
  });

  it("does not create duplicate file versions on duplicate new_version worker execution", async () => {
    const fixture = await createNewVersionUploadFixture("new-version-duplicate", {
      totalSizeBytes: 6n,
    });

    storage.putObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 6n,
      contentType: "text/plain",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-new-version-duplicate",
      },
      { prisma, storage },
    );
    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-new-version-duplicate",
      },
      { prisma, storage },
    );

    const [fileVersionCount, allVersions, file] = await Promise.all([
      prisma.fileVersion.count({
        where: {
          uploadSessionId: fixture.uploadSessionId,
        },
      }),
      prisma.fileVersion.findMany({
        where: {
          fileId: fixture.fileId,
        },
        orderBy: {
          versionNumber: "asc",
        },
      }),
      prisma.file.findUniqueOrThrow({
        where: {
          id: fixture.fileId,
        },
      }),
    ]);

    expect(fileVersionCount).toBe(1);
    expect(allVersions.map((version) => version.versionNumber)).toEqual([1, 2]);
    expect(file.currentVersionId).toBe(fixture.plannedVersionId);
  });

  it("marks missing objects as terminal upload failures", async () => {
    const fixture = await createUploadFixture("missing-object", {
      totalSizeBytes: 5n,
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-missing",
      },
      { prisma, storage },
    );

    await expectTerminalFailure(fixture, "object_missing", "corr-missing-object");
  });

  it("marks size mismatches as terminal upload failures", async () => {
    const fixture = await createUploadFixture("size-mismatch", {
      totalSizeBytes: 5n,
    });

    storage.putObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 4n,
      contentType: "text/plain",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-size",
      },
      { prisma, storage },
    );

    await expectTerminalFailure(fixture, "size_mismatch", "corr-size-mismatch");
  });

  it("marks checksum mismatches as terminal upload failures", async () => {
    const fixture = await createUploadFixture("checksum-mismatch", {
      totalSizeBytes: 5n,
      expectedSha256: "expected-sha",
    });

    storage.putObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 5n,
      contentType: "text/plain",
      sha256: "actual-sha",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-checksum",
      },
      { prisma, storage },
    );

    await expectTerminalFailure(fixture, "sha256_mismatch", "corr-checksum-mismatch");
  });

  it("throws transient storage errors for BullMQ retry without marking terminal failure", async () => {
    const fixture = await createUploadFixture("transient", {
      totalSizeBytes: 5n,
    });

    storage.failNextHeadObject(new Error("temporary storage outage"));

    await expect(
      finalizeUploadSession(
        {
          uploadSessionId: fixture.uploadSessionId,
          backgroundJobId: fixture.backgroundJobId,
          correlationId: "corr-transient",
        },
        { prisma, storage },
      ),
    ).rejects.toThrow("temporary storage outage");

    const [uploadSession, backgroundJob, versionCount] = await Promise.all([
      prisma.uploadSession.findUniqueOrThrow({
        where: {
          id: fixture.uploadSessionId,
        },
      }),
      prisma.backgroundJob.findUniqueOrThrow({
        where: {
          id: fixture.backgroundJobId,
        },
      }),
      prisma.fileVersion.count({
        where: {
          uploadSessionId: fixture.uploadSessionId,
        },
      }),
    ]);

    expect(uploadSession).toMatchObject({
      status: "completing",
      failureReason: null,
    });
    expect(backgroundJob).toMatchObject({
      status: "running",
      lastError: null,
    });
    expect(versionCount).toBe(0);
  });

  it("completes multipart uploads with ordered parts and creates one file version", async () => {
    const fixture = await createUploadFixture("multipart-success", {
      totalSizeBytes: 20n,
      expectedSha256: "sha-multipart-success",
      uploadType: "multipart",
      chunkSizeBytes: 8n,
      multipartUploadId: "multipart-success-upload",
    });

    await createUploadChunks(fixture, [
      { partNumber: 2, sizeBytes: 8n, etag: "etag-2" },
      { partNumber: 1, sizeBytes: 8n, etag: "etag-1" },
      { partNumber: 3, sizeBytes: 4n, etag: "etag-3" },
    ]);
    storage.stageMultipartObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 20n,
      contentType: "text/plain",
      sha256: "sha-multipart-success",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-multipart",
      },
      { prisma, storage },
    );

    const [file, uploadSession, versions] = await Promise.all([
      prisma.file.findUniqueOrThrow({
        where: {
          id: fixture.fileId,
        },
      }),
      prisma.uploadSession.findUniqueOrThrow({
        where: {
          id: fixture.uploadSessionId,
        },
      }),
      prisma.fileVersion.findMany({
        where: {
          uploadSessionId: fixture.uploadSessionId,
        },
      }),
    ]);
    const completed = storage.completedMultipartUploads.at(-1);

    expect(completed?.parts).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
    ]);
    expect(file).toMatchObject({
      status: "active",
      currentVersionId: fixture.plannedVersionId,
      contentHash: "sha-multipart-success",
    });
    expect(file.sizeBytes).toBe(20n);
    expect(uploadSession.status).toBe("completed");
    expect(versions).toHaveLength(1);
  });

  it("finalizes multipart new_version uploads for an existing active file", async () => {
    const fixture = await createNewVersionUploadFixture("new-version-multipart", {
      totalSizeBytes: 20n,
      expectedSha256: "sha-new-version-multipart",
      uploadType: "multipart",
      chunkSizeBytes: 8n,
      multipartUploadId: "new-version-multipart-upload",
    });

    await createUploadChunks(fixture, [
      { partNumber: 2, sizeBytes: 8n, etag: "etag-2" },
      { partNumber: 1, sizeBytes: 8n, etag: "etag-1" },
      { partNumber: 3, sizeBytes: 4n, etag: "etag-3" },
    ]);
    storage.stageMultipartObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 20n,
      contentType: "text/plain",
      sha256: "sha-new-version-multipart",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-new-version-multipart",
      },
      { prisma, storage },
    );

    const [file, versions] = await Promise.all([
      prisma.file.findUniqueOrThrow({
        where: {
          id: fixture.fileId,
        },
      }),
      prisma.fileVersion.findMany({
        where: {
          fileId: fixture.fileId,
        },
        orderBy: {
          versionNumber: "asc",
        },
      }),
    ]);
    const completed = storage.completedMultipartUploads.at(-1);

    expect(completed?.parts).toEqual([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
      { partNumber: 3, etag: "etag-3" },
    ]);
    expect(file).toMatchObject({
      status: "active",
      currentVersionId: fixture.plannedVersionId,
      contentHash: "sha-new-version-multipart",
    });
    expect(file.sizeBytes).toBe(20n);
    expect(versions.map((version) => version.versionNumber)).toEqual([1, 2]);
  });

  it("does not create duplicate versions for duplicate multipart worker execution", async () => {
    const fixture = await createUploadFixture("multipart-duplicate", {
      totalSizeBytes: 12n,
      uploadType: "multipart",
      chunkSizeBytes: 8n,
      multipartUploadId: "multipart-duplicate-upload",
    });

    await createUploadChunks(fixture, [
      { partNumber: 1, sizeBytes: 8n, etag: "etag-1" },
      { partNumber: 2, sizeBytes: 4n, etag: "etag-2" },
    ]);
    storage.stageMultipartObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 12n,
      contentType: "text/plain",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-multipart-duplicate",
      },
      { prisma, storage },
    );
    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-multipart-duplicate",
      },
      { prisma, storage },
    );

    const versionCount = await prisma.fileVersion.count({
      where: {
        uploadSessionId: fixture.uploadSessionId,
      },
    });

    expect(versionCount).toBe(1);
  });

  it("marks multipart size mismatches as terminal upload failures", async () => {
    const fixture = await createUploadFixture("multipart-size-mismatch", {
      totalSizeBytes: 12n,
      uploadType: "multipart",
      chunkSizeBytes: 8n,
      multipartUploadId: "multipart-size-mismatch-upload",
    });

    await createUploadChunks(fixture, [
      { partNumber: 1, sizeBytes: 8n, etag: "etag-1" },
      { partNumber: 2, sizeBytes: 4n, etag: "etag-2" },
    ]);
    storage.stageMultipartObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 11n,
      contentType: "text/plain",
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-multipart-size",
      },
      { prisma, storage },
    );

    await expectTerminalFailure(fixture, "size_mismatch", "corr-multipart-size-mismatch");
  });

  it("does not update currentVersionId when new_version finalization fails terminally", async () => {
    const fixture = await createNewVersionUploadFixture("new-version-missing-object", {
      totalSizeBytes: 6n,
    });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-new-version-missing",
      },
      { prisma, storage },
    );

    const [file, uploadSession, backgroundJob, versionCount] = await Promise.all([
      prisma.file.findUniqueOrThrow({
        where: {
          id: fixture.fileId,
        },
      }),
      prisma.uploadSession.findUniqueOrThrow({
        where: {
          id: fixture.uploadSessionId,
        },
      }),
      prisma.backgroundJob.findUniqueOrThrow({
        where: {
          id: fixture.backgroundJobId,
        },
      }),
      prisma.fileVersion.count({
        where: {
          uploadSessionId: fixture.uploadSessionId,
        },
      }),
    ]);

    expect(file).toMatchObject({
      status: "active",
      currentVersionId: fixture.previousVersionId,
      mimeType: fixture.previousMimeType,
    });
    expect(file.sizeBytes).toBe(fixture.previousSizeBytes);
    expect(uploadSession).toMatchObject({
      status: "failed",
      failureReason: "object_missing",
    });
    expect(backgroundJob).toMatchObject({
      status: "failed",
      lastError: "object_missing",
    });
    expect(versionCount).toBe(0);
  });

  it("rejects queued editor finalization after the direct share is revoked", async () => {
    const fixture = await createNewVersionUploadFixture("new-version-revoked-editor", {
      totalSizeBytes: 6n,
    });
    const editor = await prisma.user.create({
      data: {
        authSubject: `${runId}-revoked-editor`,
        email: `revoked-editor@${runId}.nimbus.test`,
        displayName: "revoked editor",
      },
    });
    const share = await prisma.share.create({
      data: {
        resourceType: "file",
        resourceId: fixture.fileId,
        granteeUserId: editor.id,
        role: "editor",
        createdById: fixture.userId,
      },
    });
    await prisma.uploadSession.update({
      where: { id: fixture.uploadSessionId },
      data: { ownerId: editor.id },
    });
    storage.putObject({
      bucket: "nimbus-test",
      objectKey: fixture.objectKey,
      sizeBytes: 6n,
      contentType: "text/plain",
    });
    await prisma.share.update({ where: { id: share.id }, data: { revokedAt: new Date() } });

    await finalizeUploadSession(
      {
        uploadSessionId: fixture.uploadSessionId,
        backgroundJobId: fixture.backgroundJobId,
        correlationId: "corr-revoked-editor",
      },
      { prisma, storage },
    );

    const [file, uploadSession, backgroundJob, versionCount] = await Promise.all([
      prisma.file.findUniqueOrThrow({ where: { id: fixture.fileId } }),
      prisma.uploadSession.findUniqueOrThrow({ where: { id: fixture.uploadSessionId } }),
      prisma.backgroundJob.findUniqueOrThrow({ where: { id: fixture.backgroundJobId } }),
      prisma.fileVersion.count({ where: { uploadSessionId: fixture.uploadSessionId } }),
    ]);
    expect(file.currentVersionId).toBe(fixture.previousVersionId);
    expect(file.status).toBe("active");
    expect(uploadSession).toMatchObject({
      status: "failed",
      failureReason: "upload_permission_revoked",
    });
    expect(backgroundJob).toMatchObject({
      status: "failed",
      lastError: "upload_permission_revoked",
    });
    expect(versionCount).toBe(0);
  });

  it("throws transient multipart storage errors for BullMQ retry", async () => {
    const fixture = await createUploadFixture("multipart-transient", {
      totalSizeBytes: 12n,
      uploadType: "multipart",
      chunkSizeBytes: 8n,
      multipartUploadId: "multipart-transient-upload",
    });

    await createUploadChunks(fixture, [
      { partNumber: 1, sizeBytes: 8n, etag: "etag-1" },
      { partNumber: 2, sizeBytes: 4n, etag: "etag-2" },
    ]);
    storage.failNextHeadObject(new Error("temporary multipart outage"));

    await expect(
      finalizeUploadSession(
        {
          uploadSessionId: fixture.uploadSessionId,
          backgroundJobId: fixture.backgroundJobId,
          correlationId: "corr-multipart-transient",
        },
        { prisma, storage },
      ),
    ).rejects.toThrow("temporary multipart outage");

    const [uploadSession, backgroundJob, versionCount] = await Promise.all([
      prisma.uploadSession.findUniqueOrThrow({
        where: {
          id: fixture.uploadSessionId,
        },
      }),
      prisma.backgroundJob.findUniqueOrThrow({
        where: {
          id: fixture.backgroundJobId,
        },
      }),
      prisma.fileVersion.count({
        where: {
          uploadSessionId: fixture.uploadSessionId,
        },
      }),
    ]);

    expect(uploadSession.status).toBe("completing");
    expect(backgroundJob.status).toBe("running");
    expect(versionCount).toBe(0);
  });
});

async function createUploadFixture(
  slug: string,
  options: {
    totalSizeBytes: bigint;
    expectedSha256?: string;
    uploadType?: "single_part" | "multipart";
    chunkSizeBytes?: bigint;
    multipartUploadId?: string;
  },
): Promise<UploadFixture> {
  const user = await prisma.user.create({
    data: {
      authSubject: `${runId}-${slug}`,
      email: `${slug}@${runId}.nimbus.test`,
      displayName: slug,
    },
  });
  const folder = await prisma.folder.create({
    data: {
      ownerId: user.id,
      name: "Root",
      normalizedName: "root",
      depth: 0,
    },
  });
  const file = await prisma.file.create({
    data: {
      ownerId: user.id,
      folderId: folder.id,
      name: `${slug}.txt`,
      normalizedName: `${slug}.txt`,
      extension: "txt",
      mimeType: "text/plain",
      status: "uploading",
      sizeBytes: options.totalSizeBytes,
    },
  });
  const plannedVersionId = randomUUID();
  const objectKey = `objects/${user.id}/${file.id}/versions/${plannedVersionId}/content`;
  const uploadSession = await prisma.uploadSession.create({
    data: {
      ownerId: user.id,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId,
      uploadMode: "new_file",
      filename: `${slug}.txt`,
      mimeType: "text/plain",
      totalSizeBytes: options.totalSizeBytes,
      expectedSha256: options.expectedSha256,
      finalObjectKey: objectKey,
      bucket: "nimbus-test",
      uploadType: options.uploadType ?? "single_part",
      chunkSizeBytes: options.chunkSizeBytes,
      multipartUploadId: options.multipartUploadId,
      receivedBytes: 0n,
      status: "completing",
      correlationId: `corr-${slug}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const backgroundJob = await prisma.backgroundJob.create({
    data: {
      ownerId: user.id,
      queueName: UPLOAD_FINALIZATION_QUEUE_NAME,
      resourceType: "upload_session",
      resourceId: uploadSession.id,
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      correlationId: uploadSession.correlationId,
    },
  });

  return {
    userId: user.id,
    fileId: file.id,
    uploadSessionId: uploadSession.id,
    backgroundJobId: backgroundJob.id,
    plannedVersionId,
    objectKey,
  };
}

async function createNewVersionUploadFixture(
  slug: string,
  options: {
    totalSizeBytes: bigint;
    expectedSha256?: string;
    mimeType?: string;
    uploadType?: "single_part" | "multipart";
    chunkSizeBytes?: bigint;
    multipartUploadId?: string;
  },
): Promise<NewVersionUploadFixture> {
  const user = await prisma.user.create({
    data: {
      authSubject: `${runId}-${slug}`,
      email: `${slug}@${runId}.nimbus.test`,
      displayName: slug,
    },
  });
  const folder = await prisma.folder.create({
    data: {
      ownerId: user.id,
      name: "Root",
      normalizedName: "root",
      depth: 0,
    },
  });
  const file = await prisma.file.create({
    data: {
      ownerId: user.id,
      folderId: folder.id,
      name: `${slug}.txt`,
      normalizedName: `${slug}.txt`,
      extension: "txt",
      mimeType: "text/plain",
      status: "active",
      sizeBytes: 4n,
    },
  });
  const previousVersionId = randomUUID();
  const previousUploadSession = await prisma.uploadSession.create({
    data: {
      ownerId: user.id,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId: previousVersionId,
      uploadMode: "new_file",
      filename: file.name,
      mimeType: "text/plain",
      totalSizeBytes: 4n,
      finalObjectKey: `objects/${user.id}/${file.id}/versions/${previousVersionId}/content`,
      bucket: "nimbus-test",
      status: "completed",
      expiresAt: new Date(Date.now() + 60_000),
      completedAt: new Date(),
    },
  });
  await prisma.fileVersion.create({
    data: {
      id: previousVersionId,
      fileId: file.id,
      versionNumber: 1,
      storageProvider: "s3-compatible",
      bucket: previousUploadSession.bucket,
      objectKey: previousUploadSession.finalObjectKey,
      sizeBytes: previousUploadSession.totalSizeBytes,
      mimeType: previousUploadSession.mimeType,
      uploadSessionId: previousUploadSession.id,
      createdById: user.id,
      processingStatus: "available",
    },
  });
  await prisma.file.update({
    where: {
      id: file.id,
    },
    data: {
      currentVersionId: previousVersionId,
    },
  });

  const plannedVersionId = randomUUID();
  const objectKey = `objects/${user.id}/${file.id}/versions/${plannedVersionId}/content`;
  const uploadSession = await prisma.uploadSession.create({
    data: {
      ownerId: user.id,
      targetFolderId: folder.id,
      targetFileId: file.id,
      plannedVersionId,
      uploadMode: "new_version",
      filename: file.name,
      mimeType: options.mimeType ?? "text/plain",
      totalSizeBytes: options.totalSizeBytes,
      expectedSha256: options.expectedSha256,
      finalObjectKey: objectKey,
      bucket: "nimbus-test",
      uploadType: options.uploadType ?? "single_part",
      chunkSizeBytes: options.chunkSizeBytes,
      multipartUploadId: options.multipartUploadId,
      receivedBytes: 0n,
      status: "completing",
      correlationId: `corr-${slug}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const backgroundJob = await prisma.backgroundJob.create({
    data: {
      ownerId: user.id,
      queueName: UPLOAD_FINALIZATION_QUEUE_NAME,
      resourceType: "upload_session",
      resourceId: uploadSession.id,
      status: "queued",
      attempts: 0,
      maxAttempts: 3,
      correlationId: uploadSession.correlationId,
    },
  });

  return {
    userId: user.id,
    fileId: file.id,
    folderId: folder.id,
    uploadSessionId: uploadSession.id,
    backgroundJobId: backgroundJob.id,
    plannedVersionId,
    objectKey,
    previousVersionId,
    previousSizeBytes: 4n,
    previousMimeType: "text/plain",
  };
}

async function createUploadChunks(
  fixture: UploadFixture,
  chunks: Array<{ partNumber: number; sizeBytes: bigint; etag: string }>,
) {
  const uploadSession = await prisma.uploadSession.findUniqueOrThrow({
    where: {
      id: fixture.uploadSessionId,
    },
  });

  await Promise.all(
    chunks.map((chunk) =>
      prisma.uploadChunk.create({
        data: {
          uploadSessionId: fixture.uploadSessionId,
          ownerId: fixture.userId,
          partNumber: chunk.partNumber,
          sizeBytes: chunk.sizeBytes,
          etag: chunk.etag,
          status: "uploaded",
        },
      }),
    ),
  );
  await prisma.uploadSession.update({
    where: {
      id: fixture.uploadSessionId,
    },
    data: {
      receivedBytes: chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0n),
      uploadType: "multipart",
      chunkSizeBytes: uploadSession.chunkSizeBytes ?? 8n,
      multipartUploadId: uploadSession.multipartUploadId ?? `multipart-${fixture.uploadSessionId}`,
    },
  });
}

async function expectTerminalFailure(
  fixture: UploadFixture,
  failureReason: string,
  correlationId: string,
) {
  const [file, uploadSession, backgroundJob, versionCount] = await Promise.all([
    prisma.file.findUniqueOrThrow({
      where: {
        id: fixture.fileId,
      },
    }),
    prisma.uploadSession.findUniqueOrThrow({
      where: {
        id: fixture.uploadSessionId,
      },
    }),
    prisma.backgroundJob.findUniqueOrThrow({
      where: {
        id: fixture.backgroundJobId,
      },
    }),
    prisma.fileVersion.count({
      where: {
        uploadSessionId: fixture.uploadSessionId,
      },
    }),
  ]);

  expect(file.status).toBe("failed");
  expect(uploadSession).toMatchObject({
    status: "failed",
    failureReason,
    correlationId,
  });
  expect(backgroundJob).toMatchObject({
    status: "failed",
    lastError: failureReason,
    correlationId,
  });
  expect(versionCount).toBe(0);
}

function toObjectMapKey(input: ObjectLocation): string {
  return `${input.bucket}/${input.objectKey}`;
}
