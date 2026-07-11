import { getWebConfig } from "@nimbus/config";
import { describe, expect, it } from "vitest";

import { createAuthOptions } from "../auth";

describe("production Auth.js options", () => {
  it("uses secure cookies, bounded JWT sessions, and the configured provider", () => {
    const config = getWebConfig({
      NODE_ENV: "production",
      DEPLOYMENT_PROFILE: "production",
      AUTH_MODE: "authjs",
      DEV_AUTH_ENABLED: "false",
      PUBLIC_WEB_URL: "https://nimbus.example.test",
      PUBLIC_API_URL: "https://api.nimbus.example.test",
      NEXT_PUBLIC_API_BASE_URL: "https://api.nimbus.example.test",
      ALLOWED_WEB_ORIGINS: "https://nimbus.example.test",
      AUTH_SECRET: "auth-secret-with-at-least-thirty-two-characters",
      AUTH_GITHUB_ID: "github-client-id",
      AUTH_GITHUB_SECRET: "github-client-secret-with-thirty-two-characters",
      AUTH_TRUST_HOST: "true",
      AUTH_SESSION_MAX_AGE_SECONDS: "3600",
      API_AUTH_SECRET: "api-secret-with-at-least-thirty-two-characters",
    });

    const options = createAuthOptions(config);

    expect(options.useSecureCookies).toBe(true);
    expect(options.session).toMatchObject({ strategy: "jwt", maxAge: 3600 });
    expect(options.providers).toHaveLength(1);
    expect(options.pages?.signIn).toBe("/sign-in");
  });
});
