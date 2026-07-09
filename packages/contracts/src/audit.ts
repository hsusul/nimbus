import { z } from "zod";

import { PageInfoSchema } from "./pagination";

export const AuditLogSchema = z.object({
  id: z.string(),
  actorUserId: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  targetUserId: z.string().nullable(),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: z.unknown().nullable(),
  createdAt: z.string(),
});

export const AuditLogListResponseSchema = z.object({
  data: z.object({
    auditLogs: z.array(AuditLogSchema),
    pageInfo: PageInfoSchema,
  }),
});

export type AuditLogResponse = z.infer<typeof AuditLogSchema>;
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;
