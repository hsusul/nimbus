import { describe, expect, it } from "vitest";

import { issueApiAccessToken, resolveDevUser, verifyApiAccessToken } from "../src/index";

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

describe("API access tokens", () => {
  const options = {
    secret: "test-api-auth-secret-with-at-least-32-characters",
    issuer: "nimbus-web-test",
    audience: "nimbus-api-test",
    expiresInSeconds: 300,
    now: new Date("2026-07-10T12:00:00.000Z"),
  };

  it("round-trips the verified Auth.js identity without provider credentials", async () => {
    const identity = {
      authSubject: "github:123456",
      email: "demo-owner@example.test",
      displayName: "Demo Owner",
      avatarUrl: "https://avatars.example.test/demo.png",
    };
    const token = await issueApiAccessToken(identity, options);

    await expect(verifyApiAccessToken(token, options)).resolves.toEqual(identity);
    expect(token).not.toContain(identity.email);
  });

  it("rejects expired and incorrectly scoped tokens", async () => {
    const token = await issueApiAccessToken(
      {
        authSubject: "github:123456",
        email: "demo-owner@example.test",
        displayName: "Demo Owner",
      },
      options,
    );

    await expect(
      verifyApiAccessToken(token, { ...options, audience: "another-api" }),
    ).rejects.toThrow();
    await expect(
      verifyApiAccessToken(token, { ...options, now: new Date("2026-07-10T12:06:00.000Z") }),
    ).rejects.toThrow();
  });
});
