import type { JobListQuery } from "@nimbus/contracts";
import { type BackgroundJob, getPrismaClient, type PrismaClient } from "@nimbus/db";

import { HttpError } from "../middleware/error-handler";
import { decodeCursor, encodeCursor, type Page } from "./pagination";
import type { InternalUser } from "./users";

export interface JobDto {
  jobId: string;
  type: "upload-finalization" | "metadata-indexing" | "thumbnail-generation" | "object-cleanup";
  status: "queued" | "running" | "succeeded" | "failed" | "dead_lettered";
  resourceType: string;
  resourceId: string;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
  failureCode: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export interface JobService {
  listJobs(actor: InternalUser, query: JobListQuery): Promise<Page<JobDto>>;
  getJob(actor: InternalUser, jobId: string): Promise<JobDto>;
}

export class PrismaJobService implements JobService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async listJobs(actor: InternalUser, query: JobListQuery): Promise<Page<JobDto>> {
    const cursor = decodeCursor(query.cursor);
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    const jobs = await this.prisma.backgroundJob.findMany({
      where: {
        ownerId: actor.id,
        ...(query.type ? { queueName: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(cursorDate
          ? {
              OR: [
                { createdAt: { lt: cursorDate } },
                { createdAt: cursorDate, id: { lt: cursor?.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });

    const pageJobs = jobs.slice(0, query.limit);
    const last = pageJobs.at(-1);
    const hasMore = jobs.length > query.limit;
    return {
      items: pageJobs.map(mapJob),
      pageInfo: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
            : null,
      },
    };
  }

  async getJob(actor: InternalUser, jobId: string): Promise<JobDto> {
    const job = await this.prisma.backgroundJob.findFirst({
      where: { id: jobId, ownerId: actor.id },
    });

    if (!job) {
      throw new HttpError(404, "job_not_found", "Background job was not found.");
    }

    return mapJob(job);
  }
}

function mapJob(job: BackgroundJob): JobDto {
  return {
    jobId: job.id,
    type: job.queueName as JobDto["type"],
    status: job.status as JobDto["status"],
    resourceType: job.resourceType,
    resourceId: job.resourceId,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    correlationId: job.correlationId,
    failureCode: job.failureCode,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
