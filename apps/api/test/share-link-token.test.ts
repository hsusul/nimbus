import { describe, expect, it } from "vitest";

import { generateShareLinkToken } from "../src/services/share-links";
import { hashShareLinkToken } from "../src/services/permission-service";

describe("share-link token generation", () => {
  it("generates unique 256-bit base64url tokens and SHA-256 hashes", () => {
    const tokens = Array.from({ length: 64 }, () => generateShareLinkToken());

    expect(new Set(tokens)).toHaveLength(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
      expect(hashShareLinkToken(token)).toMatch(/^[a-f0-9]{64}$/);
      expect(hashShareLinkToken(token)).not.toBe(token);
    }
  });
});
