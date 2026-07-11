import { createHash, randomBytes } from "node:crypto";

import { getDemoConfig, getWorkerConfig } from "../packages/config/src/index";
import {
  buildFileSearchDocument,
  buildFolderSearchDocument,
  disconnectPrismaClient,
  getPrismaClient,
} from "../packages/db/src/index";
import { S3CompatibleStorageProvider } from "../packages/storage/src/minio-provider";
import { generateThumbnail } from "../apps/worker/src/jobs/thumbnail-generation";

export const DEMO_IDS = {
  owner: "demo_user_owner",
  viewer: "demo_user_viewer",
  editor: "demo_user_editor",
  ownerRoot: "demo_folder_owner_root",
  viewerRoot: "demo_folder_viewer_root",
  editorRoot: "demo_folder_editor_root",
  designFolder: "demo_folder_design",
  engineeringFolder: "demo_folder_engineering",
  researchFolder: "demo_folder_research",
  sharedFolder: "demo_folder_shared",
  imageFile: "demo_file_brand_system",
  engineeringFile: "demo_file_api_notes",
  researchFile: "demo_file_research_brief",
  sharedFile: "demo_file_launch_checklist",
  trashedFile: "demo_file_archived_notes",
  imageVersion1: "demo_version_brand_1",
  imageVersion2: "demo_version_brand_2",
  engineeringVersion: "demo_version_api_notes_1",
  researchVersion: "demo_version_research_1",
  sharedVersion: "demo_version_launch_1",
  trashedVersion: "demo_version_archived_1",
  thumbnailJob: "demo_job_thumbnail",
} as const;

const DEMO_USER_IDS = [DEMO_IDS.owner, DEMO_IDS.viewer, DEMO_IDS.editor];
const FIXED_TIME = new Date("2026-07-10T12:00:00.000Z");
const IMAGE_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAMElEQVR4nGPQqDhBU8QwakHFaBCdGE1FGqMZ7cRoUaExWppWjFY4GqNVZsXgblUAAOi7OD26arz5AAAAAElFTkSuQmCC",
  "base64",
);

interface DemoFileDefinition {
  id: string;
  folderId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  versionId: string;
  uploadSessionId: string;
  deletedAt?: Date;
}

export async function seedDemoData(env: NodeJS.ProcessEnv = process.env) {
  const runtime = createDemoRuntime(env, false);
  await resetDemoRowsAndObjects(runtime);
  const { prisma, storage, config } = runtime;

  await prisma.user.createMany({
    data: [
      {
        id: DEMO_IDS.owner,
        authSubject: "dev:nimbus-demo",
        email: "demo.owner@example.test",
        displayName: "Nimbus Demo",
        status: "active",
        lastLoginAt: FIXED_TIME,
      },
      {
        id: DEMO_IDS.viewer,
        authSubject: "dev:nimbus-viewer",
        email: "demo.viewer@example.test",
        displayName: "Demo Viewer",
        status: "active",
        lastLoginAt: FIXED_TIME,
      },
      {
        id: DEMO_IDS.editor,
        authSubject: "dev:nimbus-editor",
        email: "demo.editor@example.test",
        displayName: "Demo Editor",
        status: "active",
        lastLoginAt: FIXED_TIME,
      },
    ],
  });
  await prisma.folder.createMany({
    data: [
      folder(DEMO_IDS.ownerRoot, DEMO_IDS.owner, null, "Root", 0),
      folder(DEMO_IDS.viewerRoot, DEMO_IDS.viewer, null, "Root", 0),
      folder(DEMO_IDS.editorRoot, DEMO_IDS.editor, null, "Root", 0),
      folder(DEMO_IDS.designFolder, DEMO_IDS.owner, DEMO_IDS.ownerRoot, "Design Assets", 1),
      folder(DEMO_IDS.engineeringFolder, DEMO_IDS.owner, DEMO_IDS.ownerRoot, "Engineering", 1),
      folder(DEMO_IDS.researchFolder, DEMO_IDS.owner, DEMO_IDS.ownerRoot, "Research", 1),
      folder(DEMO_IDS.sharedFolder, DEMO_IDS.owner, DEMO_IDS.ownerRoot, "Shared Examples", 1),
    ],
  });

  const definitions: DemoFileDefinition[] = [
    {
      id: DEMO_IDS.engineeringFile,
      folderId: DEMO_IDS.engineeringFolder,
      name: "API upload flow.md",
      mimeType: "text/markdown",
      bytes: Buffer.from(
        "# Nimbus upload flow\n\nMetadata through API; bytes through signed storage URLs.\n",
      ),
      versionId: DEMO_IDS.engineeringVersion,
      uploadSessionId: "demo_upload_api_notes_1",
    },
    {
      id: DEMO_IDS.researchFile,
      folderId: DEMO_IDS.researchFolder,
      name: "Storage architecture.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4\n% Nimbus synthetic demo brief\n%%EOF\n"),
      versionId: DEMO_IDS.researchVersion,
      uploadSessionId: "demo_upload_research_1",
    },
    {
      id: DEMO_IDS.sharedFile,
      folderId: DEMO_IDS.sharedFolder,
      name: "Launch checklist.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("Auth\nMigrations\nStorage\nWorkers\nSmoke tests\nRollback\n"),
      versionId: DEMO_IDS.sharedVersion,
      uploadSessionId: "demo_upload_launch_1",
    },
    {
      id: DEMO_IDS.trashedFile,
      folderId: DEMO_IDS.engineeringFolder,
      name: "Archived migration notes.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("Synthetic archived notes for the Nimbus trash demo.\n"),
      versionId: DEMO_IDS.trashedVersion,
      uploadSessionId: "demo_upload_archived_1",
      deletedAt: new Date("2026-07-09T15:00:00.000Z"),
    },
  ];

  await createFileWithVersion(runtime, {
    id: DEMO_IDS.imageFile,
    folderId: DEMO_IDS.designFolder,
    name: "Nimbus cloud mark.png",
    mimeType: "image/png",
    bytes: IMAGE_BYTES,
    versionId: DEMO_IDS.imageVersion1,
    uploadSessionId: "demo_upload_brand_1",
  });
  await createAdditionalVersion(runtime, {
    fileId: DEMO_IDS.imageFile,
    folderId: DEMO_IDS.designFolder,
    name: "Nimbus cloud mark.png",
    mimeType: "image/png",
    bytes: IMAGE_BYTES,
    versionId: DEMO_IDS.imageVersion2,
    uploadSessionId: "demo_upload_brand_2",
    versionNumber: 2,
  });
  for (const definition of definitions) await createFileWithVersion(runtime, definition);

  await prisma.share.createMany({
    data: [
      {
        id: "demo_share_viewer",
        resourceType: "file",
        resourceId: DEMO_IDS.sharedFile,
        granteeUserId: DEMO_IDS.viewer,
        role: "viewer",
        createdById: DEMO_IDS.owner,
        createdAt: FIXED_TIME,
      },
      {
        id: "demo_share_editor",
        resourceType: "file",
        resourceId: DEMO_IDS.sharedFile,
        granteeUserId: DEMO_IDS.editor,
        role: "editor",
        createdById: DEMO_IDS.owner,
        createdAt: FIXED_TIME,
      },
    ],
  });
  await prisma.shareLink.createMany({
    data: [
      {
        id: "demo_link_active",
        resourceType: "file",
        resourceId: DEMO_IDS.sharedFile,
        tokenHash: randomTokenHash(),
        role: "viewer",
        createdById: DEMO_IDS.owner,
        createdAt: FIXED_TIME,
      },
      {
        id: "demo_link_revoked",
        resourceType: "file",
        resourceId: DEMO_IDS.researchFile,
        tokenHash: randomTokenHash(),
        role: "viewer",
        createdById: DEMO_IDS.owner,
        revokedAt: new Date("2026-07-10T13:00:00.000Z"),
        createdAt: FIXED_TIME,
      },
    ],
  });
  await prisma.backgroundJob.createMany({
    data: [
      {
        id: "demo_job_index_succeeded",
        ownerId: DEMO_IDS.owner,
        queueName: "metadata-indexing",
        resourceType: "file",
        resourceId: DEMO_IDS.engineeringFile,
        status: "succeeded",
        attempts: 1,
        completedAt: new Date("2026-07-10T12:01:00.000Z"),
        createdAt: FIXED_TIME,
      },
      {
        id: "demo_job_cleanup_queued",
        ownerId: DEMO_IDS.owner,
        queueName: "object-cleanup",
        resourceType: "upload_session",
        resourceId: "demo_upload_archived_1",
        status: "queued",
        createdAt: new Date("2026-07-10T12:02:00.000Z"),
      },
      {
        id: "demo_job_upload_failed",
        ownerId: DEMO_IDS.owner,
        queueName: "upload-finalization",
        resourceType: "upload_session",
        resourceId: "demo_upload_failure_example",
        status: "failed",
        attempts: 3,
        failureCode: "demo_transient_storage_failure",
        completedAt: new Date("2026-07-10T12:03:00.000Z"),
        createdAt: new Date("2026-07-10T12:02:30.000Z"),
      },
      {
        id: DEMO_IDS.thumbnailJob,
        ownerId: DEMO_IDS.owner,
        queueName: "thumbnail-generation",
        resourceType: "file_version",
        resourceId: DEMO_IDS.imageVersion2,
        status: "queued",
        createdAt: new Date("2026-07-10T12:04:00.000Z"),
      },
    ],
  });
  await generateThumbnail(
    {
      fileVersionId: DEMO_IDS.imageVersion2,
      backgroundJobId: DEMO_IDS.thumbnailJob,
      correlationId: "demo-seed",
    },
    { storage, limits: config.thumbnail, prisma },
  );
  await prisma.auditLog.createMany({
    data: [
      audit("demo_audit_upload", "upload.completed", "file", DEMO_IDS.imageFile),
      audit("demo_audit_share", "share.created", "file", DEMO_IDS.sharedFile),
      audit("demo_audit_restore", "file.version_restored", "file", DEMO_IDS.imageFile),
    ],
  });

  return {
    users: DEMO_USER_IDS.length,
    folders: 7,
    files: 5,
    versions: 6,
    shares: 2,
    shareLinks: 2,
    jobs: 4,
  };
}

export async function resetAndSeedDemoData(env: NodeJS.ProcessEnv = process.env) {
  const runtime = createDemoRuntime(env, true);
  await resetDemoRowsAndObjects(runtime);
  return seedDemoData(env);
}

export async function closeDemoDataConnections() {
  await disconnectPrismaClient();
}

function createDemoRuntime(env: NodeJS.ProcessEnv, reset: boolean) {
  const demo = getDemoConfig(env);
  if (demo.deploymentProfile === "production") {
    throw new Error("Demo seed and reset are disabled in production.");
  }
  if (!demo.enabled || (reset && !demo.resetEnabled)) {
    throw new Error(
      reset
        ? "Demo reset requires DEMO_MODE=true and DEMO_RESET_ENABLED=true."
        : "Demo seed requires DEMO_MODE=true.",
    );
  }
  const config = getWorkerConfig(env);
  const storage = new S3CompatibleStorageProvider({
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    accessKey: config.storage.accessKey,
    secretKey: config.storage.secretKey,
    forcePathStyle: config.storage.forcePathStyle,
  });
  return { prisma: getPrismaClient(), storage, config };
}

async function createFileWithVersion(
  runtime: ReturnType<typeof createDemoRuntime>,
  definition: DemoFileDefinition,
) {
  const { prisma } = runtime;
  const extension = definition.name.includes(".") ? definition.name.split(".").pop()! : null;
  await prisma.file.create({
    data: {
      id: definition.id,
      ownerId: DEMO_IDS.owner,
      folderId: definition.folderId,
      name: definition.name,
      normalizedName: definition.name.toLowerCase(),
      extension,
      mimeType: definition.mimeType,
      status: definition.deletedAt ? "deleted" : "active",
      deletedAt: definition.deletedAt,
      sizeBytes: BigInt(definition.bytes.byteLength),
      searchDocument: buildFileSearchDocument({
        name: definition.name,
        mimeType: definition.mimeType,
        extension,
      }),
      searchIndexedAt: FIXED_TIME,
      createdAt: FIXED_TIME,
    },
  });
  await createAdditionalVersion(runtime, {
    fileId: definition.id,
    folderId: definition.folderId,
    name: definition.name,
    mimeType: definition.mimeType,
    bytes: definition.bytes,
    versionId: definition.versionId,
    uploadSessionId: definition.uploadSessionId,
    versionNumber: 1,
  });
}

async function createAdditionalVersion(
  runtime: ReturnType<typeof createDemoRuntime>,
  input: {
    fileId: string;
    folderId: string;
    name: string;
    mimeType: string;
    bytes: Uint8Array;
    versionId: string;
    uploadSessionId: string;
    versionNumber: number;
  },
) {
  const { prisma, storage, config } = runtime;
  const objectKey = `demo/${input.fileId}/versions/${input.versionId}`;
  await storage.writeObject?.({
    bucket: config.storage.bucket,
    objectKey,
    body: input.bytes,
    contentType: input.mimeType,
  });
  await prisma.uploadSession.create({
    data: {
      id: input.uploadSessionId,
      ownerId: DEMO_IDS.owner,
      targetFolderId: input.folderId,
      targetFileId: input.fileId,
      plannedVersionId: input.versionId,
      uploadMode: input.versionNumber === 1 ? "new_file" : "new_version",
      filename: input.name,
      mimeType: input.mimeType,
      totalSizeBytes: BigInt(input.bytes.byteLength),
      finalObjectKey: objectKey,
      bucket: config.storage.bucket,
      uploadType: "single_part",
      receivedBytes: BigInt(input.bytes.byteLength),
      status: "completed",
      expiresAt: new Date("2026-07-11T12:00:00.000Z"),
      completedAt: FIXED_TIME,
      createdAt: FIXED_TIME,
    },
  });
  await prisma.fileVersion.create({
    data: {
      id: input.versionId,
      fileId: input.fileId,
      versionNumber: input.versionNumber,
      storageProvider: "s3-compatible",
      bucket: config.storage.bucket,
      objectKey,
      sizeBytes: BigInt(input.bytes.byteLength),
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      mimeType: input.mimeType,
      uploadSessionId: input.uploadSessionId,
      createdById: DEMO_IDS.owner,
      processingStatus: "available",
      createdAt: new Date(FIXED_TIME.getTime() + input.versionNumber * 60_000),
    },
  });
  await prisma.file.update({
    where: { id: input.fileId },
    data: {
      currentVersionId: input.versionId,
      sizeBytes: BigInt(input.bytes.byteLength),
      contentHash: createHash("sha256").update(input.bytes).digest("hex"),
    },
  });
}

async function resetDemoRowsAndObjects(runtime: ReturnType<typeof createDemoRuntime>) {
  const { prisma, storage } = runtime;
  const [versions, thumbnails, sessions] = await Promise.all([
    prisma.fileVersion.findMany({
      where: { file: { ownerId: { in: DEMO_USER_IDS } } },
      select: { bucket: true, objectKey: true },
    }),
    prisma.thumbnail.findMany({
      where: { ownerId: { in: DEMO_USER_IDS } },
      select: { bucket: true, objectKey: true },
    }),
    prisma.uploadSession.findMany({
      where: { ownerId: { in: DEMO_USER_IDS } },
      select: { bucket: true, finalObjectKey: true },
    }),
  ]);
  const locations = [
    ...versions.map((item) => ({ bucket: item.bucket, objectKey: item.objectKey })),
    ...thumbnails.flatMap((item) =>
      item.bucket && item.objectKey ? [{ bucket: item.bucket, objectKey: item.objectKey }] : [],
    ),
    ...sessions.map((item) => ({ bucket: item.bucket, objectKey: item.finalObjectKey })),
  ];
  for (const location of uniqueLocations(locations)) {
    await storage.deleteObject(location).catch(() => undefined);
  }

  await prisma.$transaction(async (tx) => {
    await tx.auditLog.deleteMany({ where: { actorUserId: { in: DEMO_USER_IDS } } });
    await tx.share.deleteMany({
      where: {
        OR: [{ createdById: { in: DEMO_USER_IDS } }, { granteeUserId: { in: DEMO_USER_IDS } }],
      },
    });
    await tx.shareLink.deleteMany({ where: { createdById: { in: DEMO_USER_IDS } } });
    await tx.thumbnail.deleteMany({ where: { ownerId: { in: DEMO_USER_IDS } } });
    await tx.file.updateMany({
      where: { ownerId: { in: DEMO_USER_IDS } },
      data: { currentVersionId: null },
    });
    await tx.fileVersion.deleteMany({ where: { file: { ownerId: { in: DEMO_USER_IDS } } } });
    await tx.uploadChunk.deleteMany({ where: { ownerId: { in: DEMO_USER_IDS } } });
    await tx.uploadSession.deleteMany({ where: { ownerId: { in: DEMO_USER_IDS } } });
    await tx.backgroundJob.deleteMany({ where: { ownerId: { in: DEMO_USER_IDS } } });
    await tx.file.deleteMany({ where: { ownerId: { in: DEMO_USER_IDS } } });
    await tx.folder.deleteMany({ where: { ownerId: { in: DEMO_USER_IDS } } });
    await tx.user.deleteMany({ where: { id: { in: DEMO_USER_IDS } } });
  });
}

function folder(
  id: string,
  ownerId: string,
  parentFolderId: string | null,
  name: string,
  depth: number,
) {
  return {
    id,
    ownerId,
    parentFolderId,
    name,
    normalizedName: name.toLowerCase(),
    depth,
    status: "active",
    searchDocument: buildFolderSearchDocument(name),
    searchIndexedAt: FIXED_TIME,
    createdAt: FIXED_TIME,
  };
}

function audit(id: string, action: string, resourceType: string, resourceId: string) {
  return {
    id,
    actorUserId: DEMO_IDS.owner,
    action,
    resourceType,
    resourceId,
    requestId: "demo-seed",
    correlationId: "demo-seed",
    metadataJson: { source: "synthetic_demo" },
    createdAt: FIXED_TIME,
  };
}

function randomTokenHash() {
  return createHash("sha256").update(randomBytes(32)).digest("hex");
}

function uniqueLocations(locations: Array<{ bucket: string; objectKey: string }>) {
  return Array.from(
    new Map(
      locations.map((location) => [`${location.bucket}\0${location.objectKey}`, location]),
    ).values(),
  );
}
