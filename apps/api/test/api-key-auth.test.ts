import { getApiConfig } from "@nimbus/config";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { apiKeyRoutePolicy } from "../src/middleware/api-key-scopes";
import { MemoryRateLimitStore } from "../src/middleware/rate-limit";
import type { ApiKeyService } from "../src/services/api-keys";
import type { SearchService } from "../src/services/search";
import type { UserService } from "../src/services/users";
const config = {
  ...getApiConfig({ NODE_ENV: "test", DEPLOYMENT_PROFILE: "test" }),
  authMode: "dev" as const,
  devAuthEnabled: true,
  logLevel: "error" as const,
};
const testKey = ["nmb", "live", "a".repeat(43)].join("_");
const userService: UserService = {
  async ensureUser(identity) {
    return {
      id: "u",
      email: identity.email,
      displayName: identity.displayName,
      status: "active",
      storageQuotaBytes: 1n,
      storageUsedBytes: 0n,
      rootFolderId: "r",
    };
  },
};
const searchService: SearchService = {
  async search() {
    return { items: [], pageInfo: { hasMore: false, nextCursor: null } };
  },
};
function keys(scopes: never[]): ApiKeyService {
  return {
    async authenticate(raw) {
      return raw === testKey
        ? {
            apiKeyId: "k",
            scopes,
            user: { authSubject: "github:1", email: "u@example.test", displayName: "U" },
          }
        : null;
    },
    async create() {
      throw new Error("unused");
    },
    async list() {
      return [];
    },
    async get() {
      throw new Error("unused");
    },
    async revoke() {
      throw new Error("unused");
    },
  };
}
describe("API key authentication", () => {
  it("accepts a valid scoped key", async () => {
    const app = createApp({
      config,
      userService,
      searchService,
      apiKeyService: keys(["files:read"] as never[]),
      rateLimitStore: new MemoryRateLimitStore(),
    });
    await request(app)
      .get("/api/v1/search?q=x")
      .set("authorization", `Bearer ${testKey}`)
      .expect(200);
  });
  it("fails closed on missing scopes", async () => {
    const app = createApp({
      config,
      userService,
      searchService,
      apiKeyService: keys([]),
      rateLimitStore: new MemoryRateLimitStore(),
    });
    const response = await request(app)
      .get("/api/v1/search?q=x")
      .set("authorization", `Bearer ${testKey}`)
      .expect(403);
    expect(response.body.error.code).toBe("insufficient_api_key_scope");
  });
  it("rejects malformed Nimbus keys", async () => {
    const app = createApp({
      config,
      userService,
      apiKeyService: keys([]),
      rateLimitStore: new MemoryRateLimitStore(),
    });
    await request(app).get("/api/v1/me").set("authorization", "Bearer nmb_live_bad").expect(401);
  });
  it("requires browser authentication for API-key management", async () => {
    const app = createApp({
      config,
      userService,
      apiKeyService: keys([]),
      rateLimitStore: new MemoryRateLimitStore(),
    });
    const response = await request(app)
      .get("/api/v1/api-keys")
      .set("authorization", `Bearer ${testKey}`)
      .expect(403);
    expect(response.body.error.code).toBe("browser_authentication_required");
  });
  it("fails closed for API-key routes that are not explicitly classified", async () => {
    const app = createApp({
      config,
      userService,
      apiKeyService: keys(["files:read"] as never[]),
      rateLimitStore: new MemoryRateLimitStore(),
    });
    const response = await request(app)
      .get("/api/v1/future-route")
      .set("authorization", `Bearer ${testKey}`)
      .expect(403);
    expect(response.body.error.code).toBe("api_key_route_unsupported");
  });
  it("classifies every authenticated route with the intended coarse scope", () => {
    const routes = [
      ["GET", "/api/v1/me", null],
      ["GET", "/api/v1/folders/f", "files:read"],
      ["POST", "/api/v1/folders", "files:write"],
      ["POST", "/api/v1/folders/f/restore", "trash:write"],
      ["GET", "/api/v1/files/f/download", "files:read"],
      ["GET", "/api/v1/files/f/thumbnail", "files:read"],
      ["GET", "/api/v1/files/f/versions", "files:read"],
      ["POST", "/api/v1/files/f/versions/v/restore", "files:write"],
      ["POST", "/api/v1/files/f/restore", "trash:write"],
      ["POST", "/api/v1/uploads/start", "uploads:write"],
      ["GET", "/api/v1/uploads/u", "uploads:write"],
      ["POST", "/api/v1/uploads/u/chunks", "uploads:write"],
      ["POST", "/api/v1/uploads/u/complete", "uploads:write"],
      ["POST", "/api/v1/uploads/u/cancel", "uploads:write"],
      ["GET", "/api/v1/search", "files:read"],
      ["GET", "/api/v1/jobs/j", "jobs:read"],
      ["GET", "/api/v1/trash", "trash:read"],
      ["POST", "/api/v1/shares", "shares:write"],
      ["GET", "/api/v1/resources/file/f/shares", "shares:read"],
      ["DELETE", "/api/v1/shares/s", "shares:write"],
      ["POST", "/api/v1/share-links", "shares:write"],
      ["GET", "/api/v1/share-links/s", "shares:read"],
      ["DELETE", "/api/v1/share-links/s", "shares:write"],
    ] as const;
    for (const [method, path, scope] of routes)
      expect(apiKeyRoutePolicy(method, path)).toEqual({ access: "api_key", scope });
    expect(apiKeyRoutePolicy("GET", "/api/v1/audit-logs")).toEqual({ access: "browser_only" });
    expect(apiKeyRoutePolicy("POST", "/api/v1/api-keys")).toEqual({
      access: "api_key_management",
    });
  });
});
