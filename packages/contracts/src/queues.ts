import { z } from "zod";

export const UPLOAD_FINALIZATION_QUEUE_NAME = "upload-finalization";

export const UploadFinalizationJobPayloadSchema = z.object({
  uploadSessionId: z.string().min(1),
  backgroundJobId: z.string().min(1),
  correlationId: z.string().min(1).nullable().optional(),
});

export type UploadFinalizationJobPayload = z.infer<typeof UploadFinalizationJobPayloadSchema>;
