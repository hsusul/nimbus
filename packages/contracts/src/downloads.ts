import { z } from "zod";

export const FileDownloadResponseSchema = z.object({
  data: z.object({
    url: z.string().url(),
    expiresAt: z.string(),
    filename: z.string(),
    sizeBytes: z.string(),
    mimeType: z.string(),
  }),
});

export type FileDownloadResponse = z.infer<typeof FileDownloadResponseSchema>;
