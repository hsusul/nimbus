import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/index";
const old = { ...process.env };
afterEach(() => {
  process.env = { ...old };
  vi.unstubAllGlobals();
});
describe("CLI", () => {
  it("logs in without printing the key and logs out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nimbus-cli-main-"));
    process.env.NIMBUS_CONFIG_PATH = join(dir, "config.json");
    process.env.NIMBUS_API_KEY = `nmb_live_${"a".repeat(43)}`;
    const output: string[] = [];
    expect(
      await main(["login", "--url", "https://api.example.test"], {
        out: (v) => output.push(v),
        err: (v) => output.push(v),
      }),
    ).toBe(0);
    expect(output.join(" ")).not.toContain(process.env.NIMBUS_API_KEY);
    expect(await main(["logout"], { out: (v) => output.push(v), err: (v) => output.push(v) })).toBe(
      0,
    );
  });
  it("prints JSON and returns non-zero on failures", async () => {
    process.env.NIMBUS_API_KEY = `nmb_live_${"a".repeat(43)}`;
    process.env.NIMBUS_API_URL = "https://api.example.test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            data: {
              id: "u",
              email: "u@example.test",
              displayName: "U",
              status: "active",
              rootFolderId: "r",
              storage: { quotaBytes: "1", usedBytes: "0" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const out: string[] = [];
    expect(
      await main(["whoami", "--json"], { out: (v) => out.push(v), err: (v) => out.push(v) }),
    ).toBe(0);
    expect(JSON.parse(out[0]!).data.id).toBe("u");
    expect(
      await main(["unknown", "--json"], { out: (v) => out.push(v), err: (v) => out.push(v) }),
    ).toBe(1);
    expect(JSON.parse(out.at(-1)!).error).toMatchObject({
      code: "cli_error",
      message: "Unknown command: unknown",
    });
  });
});
