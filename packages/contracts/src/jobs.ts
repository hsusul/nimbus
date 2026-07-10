import { z } from "zod";

import { PageInfoSchema } from "./pagination";
import {
  METADATA_INDEXING_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
  THUMBNAIL_GENERATION_QUEUE_NAME,
  UPLOAD_FINALIZATION_QUEUE_NAME,
} from "./queues";

export const JobTypeSchema = z.enum([
  UPLOAD_FINALIZATION_QUEUE_NAME,
  METADATA_INDEXING_QUEUE_NAME,
  THUMBNAIL_GENERATION_QUEUE_NAME,
  OBJECT_CLEANUP_QUEUE_NAME,
]);

export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead_lettered",
]);

export const JobListQuerySchema = z
  .object({
    type: JobTypeSchema.optional(),
    status: JobStatusSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .strict();

export const JobSummarySchema = z
  .object({
    jobId: z.string(),
    type: JobTypeSchema,
    status: JobStatusSchema,
    resourceType: z.string(),
    resourceId: z.string(),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    correlationId: z.string().nullable(),
    failureCode: z.string().nullable(),
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    updatedAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .strict();

export const JobListResponseSchema = z
  .object({
    data: z
      .object({
        jobs: z.array(JobSummarySchema),
        pageInfo: PageInfoSchema.strict(),
      })
      .strict(),
  })
  .strict();

export const JobDetailResponseSchema = z
  .object({
    data: JobSummarySchema,
  })
  .strict();

export type JobListQuery = z.infer<typeof JobListQuerySchema>;
