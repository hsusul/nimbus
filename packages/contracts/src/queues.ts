import { z } from "zod";

export const UPLOAD_FINALIZATION_QUEUE_NAME = "upload-finalization";
export const METADATA_INDEXING_QUEUE_NAME = "metadata-indexing";
export const THUMBNAIL_GENERATION_QUEUE_NAME = "thumbnail-generation";
export const OBJECT_CLEANUP_QUEUE_NAME = "object-cleanup";

export const UploadFinalizationJobPayloadSchema = z.object({
  uploadSessionId: z.string().min(1),
  backgroundJobId: z.string().min(1),
  correlationId: z.string().min(1).nullable().optional(),
});

export type UploadFinalizationJobPayload = z.infer<typeof UploadFinalizationJobPayloadSchema>;

export const MetadataIndexingJobPayloadSchema = z
  .object({
    resourceType: z.enum(["file", "folder"]),
    resourceId: z.string().min(1),
    backgroundJobId: z.string().min(1),
    correlationId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const ThumbnailGenerationJobPayloadSchema = z
  .object({
    fileVersionId: z.string().min(1),
    backgroundJobId: z.string().min(1),
    correlationId: z.string().min(1).nullable().optional(),
  })
  .strict();

export const ObjectCleanupJobPayloadSchema = z
  .object({
    uploadSessionId: z.string().min(1),
    backgroundJobId: z.string().min(1),
    correlationId: z.string().min(1).nullable().optional(),
  })
  .strict();

export type MetadataIndexingJobPayload = z.infer<typeof MetadataIndexingJobPayloadSchema>;
export type ThumbnailGenerationJobPayload = z.infer<typeof ThumbnailGenerationJobPayloadSchema>;
export type ObjectCleanupJobPayload = z.infer<typeof ObjectCleanupJobPayloadSchema>;
