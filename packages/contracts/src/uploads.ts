import { z } from "zod";

import { FileSchema } from "./files";

export const UploadSessionStatusSchema = z.enum([
  "created",
  "uploading",
  "completing",
  "completed",
  "failed",
  "canceled",
  "expired",
]);

export const UploadStartRequestSchema = z.object({
  folderId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  totalSizeBytes: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]),
  expectedSha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export const UploadStartResponseSchema = z.object({
  data: z.object({
    uploadSessionId: z.string(),
    fileId: z.string(),
    status: UploadSessionStatusSchema,
    expiresAt: z.string(),
    signedUpload: z.object({
      url: z.string().url(),
      method: z.literal("PUT"),
      expiresAt: z.string(),
      headers: z.record(z.string()),
    }),
  }),
});

export const UploadCompleteResponseSchema = z.object({
  data: z.object({
    file: FileSchema,
  }),
});

export type UploadSessionStatus = z.infer<typeof UploadSessionStatusSchema>;
export type UploadStartRequest = z.infer<typeof UploadStartRequestSchema>;
export type UploadStartResponse = z.infer<typeof UploadStartResponseSchema>;
export type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;
