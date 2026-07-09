import { z } from "zod";

import { PageInfoSchema } from "./pagination";

const SizeBytesSchema = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative(), z.bigint()])
  .optional();

export const FileCreateRequestSchema = z.object({
  name: z.string().min(1).max(255),
  folderId: z.string().min(1).optional(),
  mimeType: z.string().min(1).max(255).optional(),
  sizeBytes: SizeBytesSchema,
});

export const FileUpdateRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    mimeType: z.string().min(1).max(255).nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.mimeType !== undefined, {
    message: "At least one file field must be provided.",
  });

export const FileMoveRequestSchema = z.object({
  folderId: z.string().min(1),
});

export const FileSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  folderId: z.string(),
  name: z.string(),
  extension: z.string().nullable(),
  mimeType: z.string().nullable(),
  status: z.string(),
  sizeBytes: z.string(),
  contentHash: z.string().nullable(),
  currentVersionId: z.string().nullable(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const FileVersionSchema = z.object({
  versionId: z.string(),
  fileId: z.string(),
  versionNumber: z.number().int().positive(),
  sizeBytes: z.string(),
  mimeType: z.string(),
  contentHash: z.string().nullable(),
  createdAt: z.string(),
  createdById: z.string(),
  processingStatus: z.string(),
  isCurrent: z.boolean(),
});

export const FileResponseSchema = z.object({
  data: FileSchema,
});

export const FileListResponseSchema = z.object({
  data: z.object({
    files: z.array(FileSchema),
    pageInfo: PageInfoSchema,
  }),
});

export const FileVersionsListResponseSchema = z.object({
  data: z.object({
    versions: z.array(FileVersionSchema),
    pageInfo: PageInfoSchema,
  }),
});

export const RestoreFileVersionResponseSchema = z.object({
  data: z.object({
    file: FileSchema,
    currentVersion: FileVersionSchema,
  }),
});

export type FileCreateRequest = z.infer<typeof FileCreateRequestSchema>;
export type FileUpdateRequest = z.infer<typeof FileUpdateRequestSchema>;
export type FileMoveRequest = z.infer<typeof FileMoveRequestSchema>;
export type FileVersion = z.infer<typeof FileVersionSchema>;
export type FileResponse = z.infer<typeof FileResponseSchema>;
export type FileListResponse = z.infer<typeof FileListResponseSchema>;
export type FileVersionsListResponse = z.infer<typeof FileVersionsListResponseSchema>;
export type RestoreFileVersionResponse = z.infer<typeof RestoreFileVersionResponseSchema>;
