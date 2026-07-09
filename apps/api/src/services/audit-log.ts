import type { CursorPaginationQuery } from "@nimbus/contracts";
import { type AuditLog, getPrismaClient, Prisma, type PrismaClient } from "@nimbus/db";
import { redact, type Redactable } from "@nimbus/logger";

import { decodeCursor, toPage, type Page } from "./pagination";

type TransactionClient = Prisma.TransactionClient;

export interface AuditContext {
  actorUserId: string;
  requestId: string;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AppendAuditLogInput extends AuditContext {
  action: string;
  resourceType: "folder" | "file";
  resourceId: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogDto {
  id: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  targetUserId: string | null;
  requestId: string | null;
  correlationId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditLogService {
  listForUser(actorUserId: string, pagination: CursorPaginationQuery): Promise<Page<AuditLogDto>>;
}

export class PrismaAuditLogService implements AuditLogService {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async listForUser(
    actorUserId: string,
    pagination: CursorPaginationQuery,
  ): Promise<Page<AuditLogDto>> {
    const cursor = decodeCursor(pagination.cursor);
    const cursorDate = cursor ? new Date(cursor.createdAt) : null;
    const cursorId = cursor?.id;
    const logs = await this.prisma.auditLog.findMany({
      where: {
        actorUserId,
        ...(cursorDate
          ? {
              OR: [
                {
                  createdAt: {
                    lt: cursorDate,
                  },
                },
                {
                  createdAt: cursorDate,
                  id: {
                    lt: cursorId,
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pagination.limit + 1,
    });

    return toPage(logs.map(mapAuditLog), pagination.limit);
  }
}

export async function appendAuditLog(tx: TransactionClient, input: AppendAuditLogInput) {
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      targetUserId: input.targetUserId ?? null,
      requestId: input.requestId,
      correlationId: input.correlationId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      metadataJson: input.metadata ? toJsonValue(redact(input.metadata as Redactable)) : undefined,
    },
  });
}

function mapAuditLog(log: AuditLog): AuditLogDto {
  return {
    id: log.id,
    actorUserId: log.actorUserId,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    targetUserId: log.targetUserId,
    requestId: log.requestId,
    correlationId: log.correlationId,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent,
    metadata: log.metadataJson,
    createdAt: log.createdAt.toISOString(),
  };
}

function toJsonValue(value: Redactable): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
