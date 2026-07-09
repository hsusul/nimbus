import { z } from "zod";

export const UploadSessionStatusSchema = z.enum([
  "created",
  "uploading",
  "completing",
  "completed",
  "failed",
  "canceled",
  "expired",
]);

export const UploadTypeSchema = z.enum(["single_part", "multipart"]);

export const UploadChunkStatusSchema = z.enum(["uploaded", "verified", "rejected"]);

export const SizeBytesSchema = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]);

export const UploadStartRequestSchema = z.object({
  folderId: z.string().min(1),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  totalSizeBytes: SizeBytesSchema,
  expectedSha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  uploadType: UploadTypeSchema.optional(),
  chunkSizeBytes: SizeBytesSchema.optional(),
});

export const SignedUploadPartSchema = z.object({
  partNumber: z.number().int().positive(),
  sizeBytes: z.string(),
  url: z.string().url(),
  method: z.literal("PUT"),
  expiresAt: z.string(),
  headers: z.record(z.string()),
});

export const UploadChunkSchema = z.object({
  id: z.string(),
  partNumber: z.number().int().positive(),
  sizeBytes: z.string(),
  sha256: z.string().nullable(),
  etag: z.string(),
  status: UploadChunkStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UploadStartResponseSchema = z.object({
  data: z.object({
    uploadSessionId: z.string(),
    fileId: z.string(),
    status: UploadSessionStatusSchema,
    uploadType: UploadTypeSchema,
    expiresAt: z.string(),
    signedUpload: z
      .object({
        url: z.string().url(),
        method: z.literal("PUT"),
        expiresAt: z.string(),
        headers: z.record(z.string()),
      })
      .optional(),
    multipart: z
      .object({
        chunkSizeBytes: z.string(),
        partCount: z.number().int().positive(),
        signedParts: z.array(SignedUploadPartSchema),
      })
      .optional(),
  }),
});

export const UploadSessionDetailResponseSchema = z.object({
  data: z.object({
    uploadSessionId: z.string(),
    fileId: z.string().nullable(),
    status: UploadSessionStatusSchema,
    uploadType: UploadTypeSchema,
    totalSizeBytes: z.string(),
    receivedBytes: z.string(),
    chunkSizeBytes: z.string().nullable(),
    partCount: z.number().int().nonnegative(),
    uploadedParts: z.array(UploadChunkSchema),
    missingPartNumbers: z.array(z.number().int().positive()),
    correlationId: z.string().nullable(),
    expiresAt: z.string(),
    signedParts: z.array(SignedUploadPartSchema).optional(),
  }),
});

export const UploadChunksResponseSchema = z.object({
  data: z.object({
    uploadSessionId: z.string(),
    uploadedParts: z.array(UploadChunkSchema),
    missingPartNumbers: z.array(z.number().int().positive()),
  }),
});

export const RegisterUploadChunkRequestSchema = z.object({
  partNumber: z.number().int().positive(),
  etag: z.string().min(1),
  sizeBytes: SizeBytesSchema,
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
});

export const RegisterUploadChunkResponseSchema = z.object({
  data: z.object({
    uploadSessionId: z.string(),
    status: UploadSessionStatusSchema,
    receivedBytes: z.string(),
    chunk: UploadChunkSchema,
    missingPartNumbers: z.array(z.number().int().positive()),
  }),
});

export const UploadCompleteResponseSchema = z.object({
  data: z.object({
    uploadSessionId: z.string(),
    status: z.enum(["completing", "completed"]),
    fileId: z.string(),
    backgroundJobId: z.string().nullable(),
    correlationId: z.string(),
  }),
});

export const UploadCancelResponseSchema = z.object({
  data: z.object({
    uploadSessionId: z.string(),
    fileId: z.string().nullable(),
    status: z.literal("canceled"),
    abortedMultipartUpload: z.boolean(),
    correlationId: z.string().nullable(),
  }),
});

export type UploadSessionStatus = z.infer<typeof UploadSessionStatusSchema>;
export type UploadType = z.infer<typeof UploadTypeSchema>;
export type UploadChunkStatus = z.infer<typeof UploadChunkStatusSchema>;
export type UploadStartRequest = z.infer<typeof UploadStartRequestSchema>;
export type UploadStartResponse = z.infer<typeof UploadStartResponseSchema>;
export type UploadSessionDetailResponse = z.infer<typeof UploadSessionDetailResponseSchema>;
export type UploadChunksResponse = z.infer<typeof UploadChunksResponseSchema>;
export type RegisterUploadChunkRequest = z.infer<typeof RegisterUploadChunkRequestSchema>;
export type RegisterUploadChunkResponse = z.infer<typeof RegisterUploadChunkResponseSchema>;
export type UploadCompleteResponse = z.infer<typeof UploadCompleteResponseSchema>;
export type UploadCancelResponse = z.infer<typeof UploadCancelResponseSchema>;
