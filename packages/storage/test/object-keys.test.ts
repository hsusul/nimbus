import { describe, expect, it } from "vitest";

import { buildSinglePartUploadObjectKey, buildVersionObjectKey } from "../src/index";

describe("object key builder", () => {
  it("builds version object keys without user filenames", () => {
    const key = buildVersionObjectKey({
      tenantId: "usr_123",
      fileId: "file_456",
      versionId: "ver_789",
    });

    expect(key).toBe("objects/usr_123/file_456/versions/ver_789/content");
    expect(key).not.toContain("quarterly-report.pdf");
  });

  it("builds single-part upload object keys without user filenames", () => {
    const key = buildSinglePartUploadObjectKey({
      tenantId: "usr_123",
      uploadSessionId: "upload_456",
    });

    expect(key).toBe("uploads/usr_123/upload_456/single/content");
    expect(key).not.toContain("avatar.png");
  });

  it("rejects unsafe key segments", () => {
    expect(() =>
      buildVersionObjectKey({
        tenantId: "usr/123",
        fileId: "file_456",
        versionId: "ver_789",
      }),
    ).toThrow();
    expect(() =>
      buildSinglePartUploadObjectKey({
        tenantId: "usr_123",
        uploadSessionId: "../upload",
      }),
    ).toThrow();
  });
});
