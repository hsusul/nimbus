import { z } from "zod";

export const ThumbnailDownloadResponseSchema = z
  .object({
    data: z
      .object({
        url: z.string().url(),
        expiresAt: z.string(),
        fileId: z.string(),
        fileVersionId: z.string(),
        mimeType: z.literal("image/webp"),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        sizeBytes: z.string(),
      })
      .strict(),
  })
  .strict();
