import { describe, expect, it, vi } from "vitest";

import { getApiHealth } from "../lib/api";

describe("web API health helper", () => {
  it("returns ok when the API health endpoint responds", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          status: "ok",
          service: "nimbus-api",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getApiHealth()).resolves.toEqual({
      status: "ok",
      service: "nimbus-api",
    });
  });

  it("returns unavailable when the API cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(getApiHealth()).resolves.toEqual({
      status: "unavailable",
    });
  });
});
