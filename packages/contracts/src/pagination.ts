import { z } from "zod";

export const CursorPaginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const PageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
