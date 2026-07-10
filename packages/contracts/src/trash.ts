import { z } from "zod";

import { PageInfoSchema } from "./pagination";

export const TrashItemSchema = z.discriminatedUnion("resourceType", [
  z
    .object({
      resourceType: z.literal("folder"),
      resourceId: z.string(),
      name: z.string(),
      parentFolderId: z.string().nullable(),
      deletedAt: z.string(),
      updatedAt: z.string(),
    })
    .strict(),
  z
    .object({
      resourceType: z.literal("file"),
      resourceId: z.string(),
      name: z.string(),
      folderId: z.string(),
      mimeType: z.string().nullable(),
      sizeBytes: z.string(),
      deletedAt: z.string(),
      updatedAt: z.string(),
    })
    .strict(),
]);

export const TrashListResponseSchema = z
  .object({
    data: z
      .object({
        items: z.array(TrashItemSchema),
        pageInfo: PageInfoSchema.strict(),
      })
      .strict(),
  })
  .strict();

export type TrashItem = z.infer<typeof TrashItemSchema>;
