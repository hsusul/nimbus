import {
  METADATA_INDEXING_QUEUE_NAME,
  MetadataIndexingJobPayloadSchema,
  type MetadataIndexingJobPayload,
} from "@nimbus/contracts";
import {
  buildFileSearchDocument,
  buildFolderSearchDocument,
  getPrismaClient,
  type PrismaClient,
} from "@nimbus/db";

import { markDurableJobFailed, markDurableJobRunning, markDurableJobSucceeded } from "./job-state";

export { METADATA_INDEXING_QUEUE_NAME };

export async function indexResourceMetadata(
  payload: MetadataIndexingJobPayload,
  prisma: PrismaClient = getPrismaClient(),
): Promise<void> {
  const parsed = MetadataIndexingJobPayloadSchema.parse(payload);
  const job = await markDurableJobRunning(parsed.backgroundJobId, prisma);

  if (
    job.queueName !== METADATA_INDEXING_QUEUE_NAME ||
    job.resourceType !== parsed.resourceType ||
    job.resourceId !== parsed.resourceId
  ) {
    await markDurableJobFailed(job.id, "job_payload_mismatch", prisma);
    return;
  }

  try {
    if (parsed.resourceType === "file") {
      const file = await prisma.file.findUnique({ where: { id: parsed.resourceId } });
      if (!file) {
        await markDurableJobSucceeded(job.id, prisma);
        return;
      }
      if (file.ownerId !== job.ownerId) {
        await markDurableJobFailed(job.id, "job_owner_mismatch", prisma);
        return;
      }

      await prisma.file.update({
        where: { id: file.id },
        data: {
          searchDocument: buildFileSearchDocument(file),
          searchIndexedAt: new Date(),
        },
      });
    } else {
      const folder = await prisma.folder.findUnique({ where: { id: parsed.resourceId } });
      if (!folder) {
        await markDurableJobSucceeded(job.id, prisma);
        return;
      }
      if (folder.ownerId !== job.ownerId) {
        await markDurableJobFailed(job.id, "job_owner_mismatch", prisma);
        return;
      }

      await prisma.folder.update({
        where: { id: folder.id },
        data: {
          searchDocument: buildFolderSearchDocument(folder.name),
          searchIndexedAt: new Date(),
        },
      });
    }

    await markDurableJobSucceeded(job.id, prisma);
  } catch (error) {
    await markDurableJobFailed(job.id, "metadata_indexing_failed", prisma);
    throw error;
  }
}
