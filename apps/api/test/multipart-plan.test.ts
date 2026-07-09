import { describe, expect, it } from "vitest";

import {
  calculatePartCount,
  getExpectedPartSize,
  getMissingPartNumbers,
} from "../src/services/uploads/multipart-plan";

describe("multipart upload planning", () => {
  it("calculates part counts with a partial final part", () => {
    expect(calculatePartCount(20n, 8n)).toBe(3);
    expect(calculatePartCount(16n, 8n)).toBe(2);
    expect(calculatePartCount(0n, 8n)).toBe(1);
  });

  it("calculates expected part sizes", () => {
    expect(getExpectedPartSize({ totalSizeBytes: 20n, chunkSizeBytes: 8n, partNumber: 1 })).toBe(
      8n,
    );
    expect(getExpectedPartSize({ totalSizeBytes: 20n, chunkSizeBytes: 8n, partNumber: 2 })).toBe(
      8n,
    );
    expect(getExpectedPartSize({ totalSizeBytes: 20n, chunkSizeBytes: 8n, partNumber: 3 })).toBe(
      4n,
    );
  });

  it("detects missing parts", () => {
    expect(
      getMissingPartNumbers({
        totalSizeBytes: 20n,
        chunkSizeBytes: 8n,
        uploadedPartNumbers: [1, 3],
      }),
    ).toEqual([2]);
  });
});
