import { ApiKeyScopes, type ApiKeyCreateRequest, type ApiKeyScope } from "@nimbus/contracts";
import { getPrismaClient, Prisma, type ApiKey, type PrismaClient } from "@nimbus/db";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { HttpError } from "../middleware/error-handler";
import { appendAuditLog, type AuditContext } from "./audit-log";
import type { InternalUser } from "./users";

const KEY_PREFIX = "nmb_live_";
const KEY_PATTERN = /^nmb_live_[A-Za-z0-9_-]{43}$/;
const MAX_ACTIVE_KEYS = 20;
const MAX_EXPIRY_MS = 366 * 24 * 60 * 60 * 1000;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export interface ApiKeyAuthentication {
  apiKeyId: string;
  scopes: ApiKeyScope[];
  user: { authSubject: string; email: string; displayName: string; avatarUrl?: string };
}

export interface ApiKeyService {
  authenticate(rawKey: string): Promise<ApiKeyAuthentication | null>;
  create(
    owner: InternalUser,
    input: ApiKeyCreateRequest,
    audit: AuditContext,
  ): Promise<ApiKeyDto & { key: string }>;
  list(ownerId: string): Promise<ApiKeyDto[]>;
  get(ownerId: string, apiKeyId: string): Promise<ApiKeyDto>;
  revoke(ownerId: string, apiKeyId: string, audit: AuditContext): Promise<ApiKeyDto>;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export class PrismaApiKeyService implements ApiKeyService {
  constructor(
    private readonly prisma: PrismaClient = getPrismaClient(),
    private readonly now = () => new Date(),
  ) {}

  async authenticate(rawKey: string): Promise<ApiKeyAuthentication | null> {
    if (!KEY_PATTERN.test(rawKey)) return null;
    const prefix = rawKey.slice(0, 20);
    const record = await this.prisma.apiKey.findUnique({
      where: { prefix },
      include: { owner: true },
    });
    if (!record || !safeEqual(record.keyHash, hashKey(rawKey))) return null;
    const now = this.now();
    if (
      record.status !== "active" ||
      record.revokedAt ||
      (record.expiresAt && record.expiresAt <= now) ||
      record.owner.status === "disabled"
    )
      return null;
    if (
      !record.lastUsedAt ||
      now.getTime() - record.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS
    ) {
      void this.prisma.apiKey
        .updateMany({
          where: {
            id: record.id,
            OR: [
              { lastUsedAt: null },
              { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } },
            ],
          },
          data: { lastUsedAt: now },
        })
        .catch(() => undefined);
    }
    return {
      apiKeyId: record.id,
      scopes: record.scopes.filter((scope): scope is ApiKeyScope =>
        ApiKeyScopes.includes(scope as ApiKeyScope),
      ),
      user: {
        authSubject: record.owner.authSubject,
        email: record.owner.email,
        displayName: record.owner.displayName ?? record.owner.email,
        ...(record.owner.avatarUrl ? { avatarUrl: record.owner.avatarUrl } : {}),
      },
    };
  }

  async create(owner: InternalUser, input: ApiKeyCreateRequest, audit: AuditContext) {
    const scopes = [...new Set(input.scopes)] as ApiKeyScope[];
    const now = this.now();
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && (expiresAt <= now || expiresAt.getTime() - now.getTime() > MAX_EXPIRY_MS)) {
      throw new HttpError(
        400,
        "invalid_api_key_expiration",
        "API key expiration must be in the future and within 366 days.",
      );
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
      const prefix = key.slice(0, 20);
      try {
        const record = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${owner.id}, 0)) IS NULL AS locked`;
          await tx.apiKey.updateMany({
            where: {
              ownerId: owner.id,
              status: "active",
              expiresAt: { lte: now },
            },
            data: { status: "expired" },
          });
          const activeCount = await tx.apiKey.count({
            where: { ownerId: owner.id, status: "active", revokedAt: null },
          });
          if (activeCount >= MAX_ACTIVE_KEYS)
            throw new HttpError(
              409,
              "api_key_limit_reached",
              "The active API key limit has been reached.",
            );
          const created = await tx.apiKey.create({
            data: {
              ownerId: owner.id,
              name: input.name.trim(),
              prefix,
              keyHash: hashKey(key),
              scopes,
              expiresAt,
            },
          });
          await appendAuditLog(tx, {
            ...audit,
            action: "api_key.created",
            resourceType: "api_key",
            resourceId: created.id,
            metadata: { apiKeyId: created.id, name: created.name, prefix: created.prefix, scopes },
          });
          return created;
        });
        return { ...mapApiKey(record), key };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const target = String(error.meta?.target ?? "");
          if (target.includes("prefix") || target.includes("key_hash")) continue;
          throw new HttpError(
            409,
            "api_key_name_conflict",
            "An active API key already uses this name.",
          );
        }
        throw error;
      }
    }
    throw new HttpError(
      503,
      "api_key_generation_failed",
      "A unique API key could not be generated.",
    );
  }

  async list(ownerId: string) {
    return (
      await this.prisma.apiKey.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } })
    ).map((record) => mapApiKey(record, this.now()));
  }
  async get(ownerId: string, apiKeyId: string) {
    const record = await this.prisma.apiKey.findFirst({ where: { id: apiKeyId, ownerId } });
    if (!record) throw new HttpError(404, "api_key_not_found", "API key not found.");
    return mapApiKey(record, this.now());
  }
  async revoke(ownerId: string, apiKeyId: string, audit: AuditContext) {
    const existing = await this.prisma.apiKey.findFirst({ where: { id: apiKeyId, ownerId } });
    if (!existing) throw new HttpError(404, "api_key_not_found", "API key not found.");
    const record = await this.prisma.$transaction(async (tx) => {
      const updated = existing.revokedAt
        ? existing
        : await tx.apiKey.update({
            where: { id: apiKeyId },
            data: { status: "revoked", revokedAt: this.now() },
          });
      if (!existing.revokedAt)
        await appendAuditLog(tx, {
          ...audit,
          action: "api_key.revoked",
          resourceType: "api_key",
          resourceId: apiKeyId,
          metadata: {
            apiKeyId,
            name: existing.name,
            prefix: existing.prefix,
            scopes: existing.scopes,
          },
        });
      return updated;
    });
    return mapApiKey(record);
  }
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function mapApiKey(record: ApiKey, now = new Date()): ApiKeyDto {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes as ApiKeyScope[],
    status:
      record.status === "active" && record.expiresAt && record.expiresAt <= now
        ? "expired"
        : record.status,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}
