import { describe, expect, it } from "vitest";

import { createLogger, redact, redactString } from "../src/index";

describe("logger redaction", () => {
  it("redacts signed URL query parameters", () => {
    const signedUrl =
      "https://storage.example.com/object?X-Amz-Signature=abc123&X-Amz-Credential=cred";

    const redacted = redactString(signedUrl);

    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("cred");
    expect(redacted).toContain("X-Amz-Signature=%5BREDACTED%5D");
  });

  it("redacts credentials embedded in connection-string URLs", () => {
    const redacted = redactString("rediss://nimbus:SuperSecretPass@key-value.internal:6379/0");

    expect(redacted).not.toContain("SuperSecretPass");
    expect(redacted).not.toContain("nimbus");
    expect(redacted).toContain("key-value.internal:6379");
  });

  it("redacts a password-only URL userinfo without inventing a username", () => {
    const redacted = redactString("postgresql://:dbpassword123@db.internal:5432/nimbus");

    expect(redacted).not.toContain("dbpassword123");
    expect(redacted).toBe("postgresql://:%5BREDACTED%5D@db.internal:5432/nimbus");
  });

  it("redacts a raw Nimbus API key embedded in a URL path", () => {
    const raw = `nmb_live_${"a".repeat(43)}`;
    const redacted = redactString(`https://api.example.com/v1/keys/${raw}`);

    expect(redacted).not.toContain(raw);
    expect(redacted).toBe("https://api.example.com/v1/keys/[REDACTED]");
  });

  it("redacts sensitive object keys", () => {
    const payload = redact({
      token: "raw-token",
      nested: {
        apiKey: "api-secret",
        keyHash: "sha256-secret",
        normal: "visible",
      },
    });

    expect(payload).toEqual({
      token: "[REDACTED]",
      nested: {
        apiKey: "[REDACTED]",
        keyHash: "[REDACTED]",
        normal: "visible",
      },
    });
  });

  it("redacts raw Nimbus API keys embedded in strings", () => {
    const raw = `nmb_live_${"a".repeat(43)}`;
    expect(redactString(`Authentication failed for ${raw}`)).toBe(
      "Authentication failed for [REDACTED]",
    );
  });

  it("redacts secret, authorization, and password query parameters inside URLs", () => {
    for (const param of ["secret", "authorization", "password", "api-key"]) {
      const redacted = redactString(`https://nimbus.example.com/resource?${param}=SENSITIVEVALUE`);
      expect(redacted, param).not.toContain("SENSITIVEVALUE");
      // The URL branch percent-encodes the marker as %5BREDACTED%5D.
      expect(redacted, param).toContain("REDACTED");
    }
  });

  it("redacts auth tokens carried in URL fragments", () => {
    const redacted = redactString(
      "https://app.example.com/callback#access_token=OAUTHSECRET&token_type=bearer",
    );
    expect(redacted).not.toContain("OAUTHSECRET");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts sensitive parameters in plain (non-URL) strings", () => {
    expect(redactString("login attempt password=hunter2 for user")).toBe(
      "login attempt password=[REDACTED] for user",
    );
    expect(redactString("authorization=Bearer%20opaque-token")).toBe("authorization=[REDACTED]");
  });

  it("emits structured JSON with request and correlation IDs", () => {
    const lines: string[] = [];
    const logger = createLogger({
      service: "test",
      sink: (line) => lines.push(line),
    });

    logger.info("hello", {
      request_id: "req_123",
      correlation_id: "corr_123",
      authorization: "Bearer secret-token",
    });

    const parsed = JSON.parse(lines[0] ?? "{}");

    expect(parsed.service).toBe("test");
    expect(parsed.request_id).toBe("req_123");
    expect(parsed.correlation_id).toBe("corr_123");
    expect(parsed.authorization).toBe("[REDACTED]");
  });
});
