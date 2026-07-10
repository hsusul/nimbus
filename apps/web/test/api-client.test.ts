import { describe, expect, it, vi } from "vitest";

import { NimbusApiClient } from "../lib/api-client";

const config = {
  apiBaseUrl: "http://localhost:4000",
  devAuth: { user: "web-test", email: "web-test@nimbus.local", name: "Web Test" },
};

describe("Nimbus API client", () => {
  it("adds dev auth headers and parses strict shared responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "user-1",
            email: "web-test@nimbus.local",
            displayName: "Web Test",
            status: "active",
            rootFolderId: "root-1",
            storage: { quotaBytes: "100", usedBytes: "5" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new NimbusApiClient(config).me;

    expect(result.data.rootFolderId).toBe("root-1");
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-nimbus-dev-user": "web-test",
      "x-nimbus-dev-email": "web-test@nimbus.local",
    });
  });

  it("preserves safe API errors and rejects unexpected response shapes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { code: "file_not_found", message: "File was not found.", requestId: "req-1" },
            }),
            { status: 404 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: {
                results: [],
                pageInfo: { hasMore: false, nextCursor: null },
                objectKey: "private",
              },
            }),
            { status: 200 },
          ),
        ),
    );
    const client = new NimbusApiClient(config);
    await expect(client.getFile("missing")).rejects.toMatchObject({
      code: "file_not_found",
      requestId: "req-1",
    });
    await expect(client.search({ q: "report", limit: 20 })).rejects.toThrow();
  });
});
