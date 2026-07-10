import { describe, expect, it } from "vitest";

import { TrashListResponseSchema } from "../src";

describe("trash contracts", () => {
  it("accepts safe deleted resources and rejects private fields", () => {
    const response = {
      data: {
        items: [
          {
            resourceType: "file",
            resourceId: "file-1",
            name: "report.pdf",
            folderId: "folder-1",
            mimeType: "application/pdf",
            sizeBytes: "10",
            deletedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    };
    expect(TrashListResponseSchema.parse(response)).toEqual(response);
    expect(() =>
      TrashListResponseSchema.parse({
        ...response,
        data: {
          ...response.data,
          items: [{ ...response.data.items[0], objectKey: "private" }],
        },
      }),
    ).toThrow();
  });
});
