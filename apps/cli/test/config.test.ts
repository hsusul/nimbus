import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readConfig, removeConfig, writeConfig } from "../src/config";
const old = { ...process.env };
afterEach(() => {
  process.env = { ...old };
});
describe("CLI config", () => {
  it("writes user-only credentials and supports environment overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nimbus-cli-"));
    process.env.NIMBUS_CONFIG_PATH = join(dir, "config.json");
    await writeConfig({ apiUrl: "https://api.example.test", apiKey: "nmb_live_stored" });
    if (process.platform !== "win32")
      expect((await stat(process.env.NIMBUS_CONFIG_PATH)).mode & 0o777).toBe(0o600);
    process.env.NIMBUS_API_KEY = "nmb_live_override";
    expect((await readConfig()).apiKey).toBe("nmb_live_override");
    await removeConfig();
  });
});
