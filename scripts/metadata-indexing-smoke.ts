import { METADATA_INDEXING_QUEUE_NAME } from "../packages/contracts/src/queues";
import { disconnectPrismaClient, getPrismaClient } from "../packages/db/src/index";
import { indexResourceMetadata } from "../apps/worker/src/jobs/metadata-indexing";

const prisma = getPrismaClient();
const runId = `metadata-indexing-smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
      name: "before.txt",
      normalizedName: "before.txt",
      extension: "txt",
      mimeType: "text/plain",
      status: "active",
      searchDocument: "stale payload value",
    },
  });
  await prisma.file.update({
    where: { id: file.id },
    data: { name: "Current Report.pdf", normalizedName: "current report.pdf", extension: "pdf" },
  });
  const job = await prisma.backgroundJob.create({
    data: {
      ownerId: owner.id,
      queueName: METADATA_INDEXING_QUEUE_NAME,
      resourceType: "file",
      resourceId: file.id,
      status: "queued",
    },
  });

  const startedAt = performance.now();
  await indexResourceMetadata({
    resourceType: "file",
    resourceId: file.id,
    backgroundJobId: job.id,
    correlationId: runId,
  });
  const durationMs = performance.now() - startedAt;
  const indexed = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
  const durable = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });

  if (
    indexed.searchDocument !== "Current Report.pdf pdf text/plain" ||
    !indexed.searchIndexedAt ||
    durable.status !== "succeeded"
  ) {
    throw new Error("metadata_indexing_smoke_mismatch");
  }

  console.log(
    JSON.stringify({
      status: "ok",
      currentMetadataUsed: true,
      stalePayloadIgnored: true,
      durationMs: Number(durationMs.toFixed(2)),
    }),
  );
} finally {
  const user = await prisma.user.findUnique({ where: { authSubject: runId } });
  if (user) {
    await prisma.backgroundJob.deleteMany({ where: { ownerId: user.id } });
    await prisma.file.deleteMany({ where: { ownerId: user.id } });
    await prisma.folder.deleteMany({ where: { ownerId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await disconnectPrismaClient();
}
