import { getApiConfig } from "@nimbus/config";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
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
const testKey = ["nmb", "live", "test-only-key-material"].join("_");
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
});
