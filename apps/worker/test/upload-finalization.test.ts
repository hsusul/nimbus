import { UPLOAD_FINALIZATION_QUEUE_NAME } from "@nimbus/contracts";
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { finalizeUploadSession } from "../src/jobs/upload-finalization";

class FakeObjectStorageProvider implements ObjectStorageProvider {
  private readonly objects = new Map<string, ObjectMetadata>();
  private transientError: Error | null = null;

  async createSignedUploadUrl(_input: SignedUploadUrlInput): Promise<SignedUrl> {
    throw new Error("not implemented");
  }

  async createSignedDownloadUrl(_input: SignedDownloadUrlInput): Promise<SignedUrl> {
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
});

async function createUploadFixture(
  slug: string,
  options: {
    totalSizeBytes: bigint;
    expectedSha256?: string;
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
      status: "completing",
      correlationId: `corr-${slug}`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const backgroundJob = await prisma.backgroundJob.create({
    data: {
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
