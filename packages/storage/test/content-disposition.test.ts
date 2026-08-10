import { describe, expect, it } from "vitest";

import { buildContentDisposition } from "../src/index";

const isAsciiHeaderValue = (value: string) => /^[\x20-\x7e]*$/.test(value);

describe("content disposition builder", () => {
  it("keeps a plain ASCII filename in the quoted form only", () => {
    expect(buildContentDisposition("report.pdf")).toBe('attachment; filename="report.pdf"');
  });

  it("sanitizes quotes and backslashes in the ASCII fallback", () => {
    expect(buildContentDisposition('quote"v2\\.txt')).toBe('attachment; filename="quote_v2_.txt"');
  });

  it("adds an RFC 5987 filename* for non-ASCII names and stays ASCII-safe", () => {
    const header = buildContentDisposition("café.pdf");

    expect(header).toBe("attachment; filename=\"caf_.pdf\"; filename*=UTF-8''caf%C3%A9.pdf");
    expect(isAsciiHeaderValue(header)).toBe(true);
  });

  it("percent-encodes spaces and multibyte characters in filename*", () => {
    const header = buildContentDisposition("报告 2024.pdf");

    expect(header).toBe(
      "attachment; filename=\"__ 2024.pdf\"; filename*=UTF-8''%E6%8A%A5%E5%91%8A%202024.pdf",
    );
    expect(header).not.toContain("报告");
    expect(isAsciiHeaderValue(header)).toBe(true);
  });

  it("does not leave RFC 5987 reserved characters unencoded", () => {
    const header = buildContentDisposition("(café)'*.pdf");

    expect(header).toContain("filename*=UTF-8''%28caf%C3%A9%29%27%2A.pdf");
    expect(isAsciiHeaderValue(header)).toBe(true);
  });
});
