import { describe, expect, it } from "vitest";

import {
  PublicShareResponseSchema,
  ShareLinkCreateResponseSchema,
  ShareLinkResponseSchema,
  ShareLinkTokenSchema,
  ShareListResponseSchema,
  ShareResponseSchema,
} from "../src/index";

const share = {
  id: "share_123",
  resourceType: "file",
  resourceId: "file_123",
  grantee: {
    userId: "user_456",
    email: "recipient@example.com",
    displayName: "Recipient",
  },
  role: "viewer",
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

const shareLink = {
  id: "link_123",
  resourceType: "file",
  resourceId: "file_123",
  role: "viewer",
  expiresAt: null,
  revokedAt: null,
  useCount: 0,
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
};

describe("M7 sharing contracts", () => {
  it("validates direct share management responses", () => {
    expect(() => ShareResponseSchema.parse({ data: share })).not.toThrow();
    expect(() => ShareListResponseSchema.parse({ data: { shares: [share] } })).not.toThrow();
  });

  it("returns a public token only from link creation", () => {
    expect(() =>
      ShareLinkCreateResponseSchema.parse({
        data: { shareLink, token: "a".repeat(43) },
      }),
    ).not.toThrow();
    expect(() => ShareLinkResponseSchema.parse({ data: shareLink })).not.toThrow();
    expect(() => ShareLinkResponseSchema.parse({ data: { ...shareLink, token: "raw" } })).toThrow();
  });

  it("accepts only 32-byte base64url public tokens", () => {
    expect(ShareLinkTokenSchema.safeParse("a".repeat(43)).success).toBe(true);
    expect(ShareLinkTokenSchema.safeParse("a".repeat(42)).success).toBe(false);
    expect(ShareLinkTokenSchema.safeParse(`${"a".repeat(42)}=`).success).toBe(false);
  });

  it("validates minimal public metadata with an optional signed download", () => {
    const resource = {
      resourceType: "file",
      resourceId: "file_123",
      name: "report.txt",
      mimeType: "text/plain",
      sizeBytes: "12",
      updatedAt: "2026-07-09T00:00:00.000Z",
    };

    expect(() => PublicShareResponseSchema.parse({ data: { resource } })).not.toThrow();
    expect(() =>
      PublicShareResponseSchema.parse({
        data: { resource: { ...resource, tokenHash: "private" } },
      }),
    ).toThrow();
    expect(() =>
      PublicShareResponseSchema.parse({
        data: {
          resource,
          download: {
            url: "https://storage.example.com/download?signature=redacted",
            expiresAt: "2026-07-09T00:05:00.000Z",
            filename: "report.txt",
            sizeBytes: "12",
            mimeType: "text/plain",
          },
        },
      }),
    ).not.toThrow();
  });
});
