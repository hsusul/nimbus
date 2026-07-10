import { z } from "zod";

export * from "./audit";
export * from "./downloads";
export * from "./files";
export * from "./folders";
export * from "./jobs";
export * from "./pagination";
export * from "./queues";
export * from "./search";
export * from "./sharing";
export * from "./thumbnails";
export * from "./trash";
export * from "./uploads";

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export const HealthResponseSchema = z.object({
  data: z.object({
    status: z.literal("ok"),
    service: z.string(),
    timestamp: z.string(),
    requestId: z.string(),
  }),
});

export const ReadinessResponseSchema = z.object({
  data: z.object({
    status: z.enum(["ready", "not_ready"]),
    service: z.string(),
    timestamp: z.string(),
    requestId: z.string(),
    dependencies: z.object({
      postgres: z.boolean(),
      redis: z.boolean(),
    }),
  }),
});

export const MeResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    email: z.string().email(),
    displayName: z.string(),
    status: z.string(),
    rootFolderId: z.string(),
    storage: z.object({
      quotaBytes: z.string(),
      usedBytes: z.string(),
    }),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
