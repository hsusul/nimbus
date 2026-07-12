import { getPrismaClient } from "@nimbus/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaApiKeyService } from "../src/services/api-keys";

const prisma = getPrismaClient();
const suffix = `m11-${Date.now()}`;
let ownerId = "";
const audit = { actorUserId: "", requestId: "req_m11" };
beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      authSubject: `dev:${suffix}`,
      email: `${suffix}@example.test`,
      displayName: "M11 User",
    },
  });
  ownerId = user.id;
  audit.actorUserId = user.id;
});
afterAll(async () => {
  if (ownerId) {
    await prisma.auditLog.deleteMany({ where: { actorUserId: ownerId } });
    await prisma.user.delete({ where: { id: ownerId } });
  }
});

describe("personal API keys", () => {
  it("returns a raw key once and persists only its hash", async () => {
    const service = new PrismaApiKeyService();
    const owner = {
      id: ownerId,
      email: `${suffix}@example.test`,
      displayName: "M11 User",
      status: "active",
      storageQuotaBytes: 1n,
      storageUsedBytes: 0n,
      rootFolderId: "root",
    };
    const created = await service.create(owner, { name: "SDK", scopes: ["files:read"] }, audit);
    expect(created.key).toMatch(/^nmb_live_/);
    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.keyHash).not.toContain(created.key);
    expect(stored.prefix).toBe(created.key.slice(0, 20));
    expect(await service.authenticate(created.key)).toMatchObject({
      apiKeyId: created.id,
      scopes: ["files:read"],
    });
    expect((await service.list(ownerId))[0]).not.toHaveProperty("key");
    expect(JSON.stringify(await service.get(ownerId, created.id))).not.toContain(stored.keyHash);
    await expect(service.get("another-user", created.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "api_key_not_found",
    });
    expect(await service.authenticate(`${created.key}x`)).toBeNull();
    expect(await service.authenticate(` ${created.key}`)).toBeNull();
  });
  it("revokes immediately and writes safe audits", async () => {
    const service = new PrismaApiKeyService();
    const owner = {
      id: ownerId,
      email: `${suffix}@example.test`,
      displayName: "M11 User",
      status: "active",
      storageQuotaBytes: 1n,
      storageUsedBytes: 0n,
      rootFolderId: "root",
    };
    const created = await service.create(owner, { name: "CLI", scopes: ["jobs:read"] }, audit);
    await service.revoke(ownerId, created.id, audit);
    expect(await service.authenticate(created.key)).toBeNull();
    const logs = await prisma.auditLog.findMany({ where: { resourceId: created.id } });
    expect(JSON.stringify(logs)).not.toContain(created.key);
    expect(logs.map((l) => l.action)).toEqual(["api_key.created", "api_key.revoked"]);
  });
  it("rejects expired keys and keys belonging to disabled users", async () => {
    const service = new PrismaApiKeyService();
    const owner = {
      id: ownerId,
      email: `${suffix}@example.test`,
      displayName: "M11 User",
      status: "active",
      storageQuotaBytes: 1n,
      storageUsedBytes: 0n,
      rootFolderId: "root",
    };
    const expired = await service.create(
      owner,
      {
        name: "Expired",
        scopes: ["files:read"],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      audit,
    );
    await prisma.apiKey.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await service.authenticate(expired.key)).toBeNull();
    const disabled = await service.create(
      owner,
      { name: "Disabled", scopes: ["files:read"] },
      audit,
    );
    await prisma.user.update({ where: { id: ownerId }, data: { status: "disabled" } });
    expect(await service.authenticate(disabled.key)).toBeNull();
    await prisma.user.update({ where: { id: ownerId }, data: { status: "active" } });
  });
  it("serializes concurrent creation so the active-key limit cannot be bypassed", async () => {
    const concurrentOwner = await prisma.user.create({
      data: {
        authSubject: `dev:${suffix}:concurrent`,
        email: `concurrent-${suffix}@example.test`,
      },
    });
    try {
      const service = new PrismaApiKeyService();
      const owner = {
        id: concurrentOwner.id,
        email: concurrentOwner.email,
        displayName: "Concurrent User",
        status: "active",
        storageQuotaBytes: 1n,
        storageUsedBytes: 0n,
        rootFolderId: "root",
      };
      const results = await Promise.allSettled(
        Array.from({ length: 21 }, (_, index) =>
          service.create(
            owner,
            { name: `Concurrent ${index}`, scopes: ["files:read"] },
            { actorUserId: concurrentOwner.id, requestId: `req-${index}` },
          ),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(await prisma.apiKey.count({ where: { ownerId: concurrentOwner.id } })).toBe(20);
    } finally {
      await prisma.auditLog.deleteMany({ where: { actorUserId: concurrentOwner.id } });
      await prisma.user.delete({ where: { id: concurrentOwner.id } });
    }
  });
});
