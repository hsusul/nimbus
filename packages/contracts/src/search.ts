import { z } from "zod";

import { PageInfoSchema } from "./pagination";

export const SearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(128),
    type: z.enum(["file", "folder"]).optional(),
    mimeType: z.string().trim().min(1).max(255).optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === "folder" && value.mimeType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mimeType"],
        message: "mimeType applies only to file search.",
      });
    }
  });

const SearchAccessSchema = z
  .object({
    classification: z.enum(["owner", "shared"]),
    role: z.enum(["owner", "viewer", "editor"]),
  })
  .strict();

export const FileSearchResultSchema = z
  .object({
    resourceType: z.literal("file"),
    resourceId: z.string(),
    name: z.string(),
    mimeType: z.string().nullable(),
    sizeBytes: z.string(),
    folderId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    access: SearchAccessSchema,
  })
  .strict();

export const FolderSearchResultSchema = z
  .object({
    resourceType: z.literal("folder"),
    resourceId: z.string(),
    name: z.string(),
    parentFolderId: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    access: z
      .object({
        classification: z.literal("owner"),
        role: z.literal("owner"),
      })
      .strict(),
  })
  .strict();

export const SearchResultSchema = z.discriminatedUnion("resourceType", [
  FileSearchResultSchema,
  FolderSearchResultSchema,
]);

export const SearchResponseSchema = z
  .object({
    data: z
      .object({
        results: z.array(SearchResultSchema),
        pageInfo: PageInfoSchema.strict(),
      })
      .strict(),
  })
  .strict();

export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
