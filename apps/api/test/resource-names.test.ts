import { describe, expect, it } from "vitest";

import { HttpError } from "../src/middleware/error-handler";
import { normalizeResourceName } from "../src/services/resource-names";

describe("resource name normalization", () => {
  it("normalizes folder names by trimming, collapsing whitespace, and lowercasing", () => {
    expect(normalizeResourceName("  Quarterly   Reports  ")).toEqual({
      name: "Quarterly Reports",
      normalizedName: "quarterly reports",
      extension: null,
    });
  });

  it("extracts normalized file extensions without treating hidden names as extensions", () => {
    expect(normalizeResourceName("  Report.Final.PDF ")).toMatchObject({
      name: "Report.Final.PDF",
      normalizedName: "report.final.pdf",
      extension: "pdf",
    });
    expect(normalizeResourceName(".env")).toMatchObject({
      extension: null,
    });
  });

  it("rejects empty names and path separators", () => {
    expect(() => normalizeResourceName("   ")).toThrow(HttpError);
    expect(() => normalizeResourceName("bad/name")).toThrow(HttpError);
    expect(() => normalizeResourceName("bad\\name")).toThrow(HttpError);
  });
});
