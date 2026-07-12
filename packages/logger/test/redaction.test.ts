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
