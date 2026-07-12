import { z } from "zod";

export const ApiKeyScopeSchema = z.enum([
  "files:read",
  "files:write",
  "uploads:write",
  "shares:read",
  "shares:write",
  "jobs:read",
  "trash:read",
  "trash:write",
]);

export const ApiKeyScopes = ApiKeyScopeSchema.options;

export const ApiKeyCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(ApiKeyScopeSchema)
    .min(1)
    .max(ApiKeyScopes.length)
    .transform((v) => [...new Set(v)]),
  expiresAt: z.string().datetime().optional(),
});

export const ApiKeyMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(ApiKeyScopeSchema),
  status: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export const ApiKeyCreateResponseSchema = z.object({
  data: ApiKeyMetadataSchema.extend({
    key: z.string().startsWith("nmb_live_"),
    warning: z.literal("Store this key securely. It will not be shown again."),
  }),
});
export const ApiKeyResponseSchema = z.object({ data: ApiKeyMetadataSchema });
export const ApiKeyListResponseSchema = z.object({
  data: z.object({ apiKeys: z.array(ApiKeyMetadataSchema) }),
});

export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;
export type ApiKeyCreateRequest = z.input<typeof ApiKeyCreateRequestSchema>;
export type ApiKeyCreateResponse = z.infer<typeof ApiKeyCreateResponseSchema>;
export type ApiKeyResponse = z.infer<typeof ApiKeyResponseSchema>;
export type ApiKeyListResponse = z.infer<typeof ApiKeyListResponseSchema>;
