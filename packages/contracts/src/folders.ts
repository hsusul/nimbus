import { z } from "zod";

import { PageInfoSchema } from "./pagination";

export const FolderCreateRequestSchema = z.object({
  name: z.string().min(1).max(255),
  parentFolderId: z.string().min(1).optional(),
});

export const FolderUpdateRequestSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
  })
  .refine((value) => value.name !== undefined, {
    message: "At least one folder field must be provided.",
  });

export const FolderMoveRequestSchema = z.object({
  parentFolderId: z.string().min(1),
});

export const FolderResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    ownerId: z.string(),
    parentFolderId: z.string().nullable(),
    name: z.string(),
    depth: z.number().int().nonnegative(),
    status: z.string(),
    deletedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const FolderChildSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("folder"),
    id: z.string(),
    name: z.string(),
    parentFolderId: z.string(),
    depth: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  z.object({
    type: z.literal("file"),
    id: z.string(),
    name: z.string(),
    folderId: z.string(),
    mimeType: z.string().nullable(),
    sizeBytes: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
]);

export const FolderChildrenResponseSchema = z.object({
  data: z.object({
    folderId: z.string(),
    children: z.array(FolderChildSchema),
    pageInfo: PageInfoSchema,
  }),
});

export type FolderCreateRequest = z.infer<typeof FolderCreateRequestSchema>;
export type FolderUpdateRequest = z.infer<typeof FolderUpdateRequestSchema>;
export type FolderMoveRequest = z.infer<typeof FolderMoveRequestSchema>;
export type FolderResponse = z.infer<typeof FolderResponseSchema>;
export type FolderChild = z.infer<typeof FolderChildSchema>;
export type FolderChildrenResponse = z.infer<typeof FolderChildrenResponseSchema>;
