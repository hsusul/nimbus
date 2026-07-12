import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  apiUrl: string;
  apiKey: string;
}
export const defaultConfigPath = () =>
  process.env.NIMBUS_CONFIG_PATH ?? join(homedir(), ".config", "nimbus", "config.json");
export async function readConfig(): Promise<CliConfig> {
  const stored: Partial<CliConfig> = await readFile(defaultConfigPath(), "utf8")
    .then((v) => JSON.parse(v) as Partial<CliConfig>)
    .catch(() => ({}) as Partial<CliConfig>);
  const apiKey = process.env.NIMBUS_API_KEY ?? stored.apiKey;
  const apiUrl = process.env.NIMBUS_API_URL ?? stored.apiUrl;
  if (!apiKey || !apiUrl)
    throw new Error("Run `nimbus login` or set NIMBUS_API_KEY and NIMBUS_API_URL.");
  return { apiKey, apiUrl };
}
export async function writeConfig(config: CliConfig) {
  const path = defaultConfigPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
}
export async function removeConfig() {
  await rm(defaultConfigPath(), { force: true });
}
