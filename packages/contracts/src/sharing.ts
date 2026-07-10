import { z } from "zod";

export const ShareResourceTypeSchema = z.literal("file");
export const DirectShareRoleSchema = z.enum(["viewer", "editor"]);
export const ShareLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const ShareCreateRequestSchema = z.object({
  resourceType: ShareResourceTypeSchema,
  resourceId: z.string().min(1),
  granteeEmail: z.string().email(),
  role: DirectShareRoleSchema,
});

export const ShareSchema = z.object({
  id: z.string(),
  resourceType: ShareResourceTypeSchema,
  resourceId: z.string(),
  grantee: z.object({
    userId: z.string(),
    email: z.string().email(),
    displayName: z.string(),
  }),
  role: DirectShareRoleSchema,
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ShareResponseSchema = z.object({
  data: ShareSchema,
});

export const ShareListResponseSchema = z.object({
  data: z.object({
    shares: z.array(ShareSchema),
  }),
});

export const ShareLinkCreateRequestSchema = z.object({
  resourceType: ShareResourceTypeSchema,
  resourceId: z.string().min(1),
});

export const ShareLinkSchema = z
  .object({
    id: z.string(),
    resourceType: ShareResourceTypeSchema,
    resourceId: z.string(),
    role: z.literal("viewer"),
    expiresAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    useCount: z.number().int().nonnegative(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const ShareLinkCreateResponseSchema = z.object({
  data: z.object({
    shareLink: ShareLinkSchema,
    token: ShareLinkTokenSchema,
  }),
});

export const ShareLinkResponseSchema = z.object({
  data: ShareLinkSchema,
});

export const PublicShareQuerySchema = z.object({
  download: z.enum(["true", "false"]).default("false"),
});

export const PublicShareResponseSchema = z
  .object({
    data: z
      .object({
        resource: z
          .object({
            resourceType: ShareResourceTypeSchema,
            resourceId: z.string(),
            name: z.string(),
            mimeType: z.string().nullable(),
            sizeBytes: z.string(),
            updatedAt: z.string(),
          })
          .strict(),
        download: z
          .object({
            url: z.string().url(),
            expiresAt: z.string(),
            filename: z.string(),
            sizeBytes: z.string(),
            mimeType: z.string(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export type ShareCreateRequest = z.infer<typeof ShareCreateRequestSchema>;
export type ShareLinkCreateRequest = z.infer<typeof ShareLinkCreateRequestSchema>;
export type Share = z.infer<typeof ShareSchema>;
export type ShareLink = z.infer<typeof ShareLinkSchema>;
export type PublicShareResponse = z.infer<typeof PublicShareResponseSchema>;
