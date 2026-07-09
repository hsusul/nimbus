import { describe, expect, it } from "vitest";

import { resolveDevUser } from "../src/index";

describe("resolveDevUser", () => {
  it("resolves a development user from headers", () => {
    const user = resolveDevUser(
      {
        "x-nimbus-dev-user": "test-user",
        "x-nimbus-dev-email": "test@example.com",
      },
      { enabled: true },
    );

    expect(user).toEqual({
      authSubject: "dev:test-user",
      email: "test@example.com",
      displayName: "Test User",
    });
  });

  it("returns null when dev auth is disabled", () => {
    expect(resolveDevUser({ "x-nimbus-dev-user": "test-user" }, { enabled: false })).toBeNull();
  });
});
