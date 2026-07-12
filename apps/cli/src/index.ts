import { NimbusClient, NimbusError, type UploadSource } from "@nimbus/sdk";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Writable } from "node:stream";
import { readConfig, removeConfig, writeConfig } from "./config";

export async function main(
  argv = process.argv.slice(2),
  io = { out: (v: string) => console.log(v), err: (v: string) => console.error(v) },
  signal?: AbortSignal,
): Promise<number> {
  const json = takeFlag(argv, "--json");
  const command = argv.shift();
  try {
    if (!command || command === "help" || command === "--help") {
      io.out(help);
      return 0;
    }
    if (command === "login") {
      const apiUrl =
        takeOption(argv, "--url") ?? process.env.NIMBUS_API_URL ?? "http://localhost:4000";
      let apiKey = process.env.NIMBUS_API_KEY;
      if (!apiKey) apiKey = await readSecret("Nimbus API key: ");
      if (!/^nmb_live_[A-Za-z0-9_-]{43}$/.test(apiKey))
        throw new Error("Invalid Nimbus API key format.");
      await writeConfig({ apiUrl, apiKey });
      io.out(
        json
          ? JSON.stringify({ data: { authenticated: true, apiUrl } })
          : "Nimbus credentials saved with user-only permissions.",
      );
      return 0;
    }
    if (command === "logout") {
      await removeConfig();
      io.out(
        json ? JSON.stringify({ data: { authenticated: false } }) : "Nimbus credentials removed.",
      );
      return 0;
    }
    const config = await readConfig();
    const client = new NimbusClient({
      baseUrl: config.apiUrl,
      apiKey: config.apiKey,
      userAgent: "nimbus-cli/0.1.0",
    });
    let result: unknown;
    if (command === "whoami") result = await client.getCurrentUser();
    else if (command === "ls")
      result = argv[0] ? await client.listFolderChildren(argv[0]) : await client.listFiles();
    else if (command === "mkdir") {
      const name = required(argv.shift(), "name");
      result = await client.createFolder(name, takeOption(argv, "--parent"));
    } else if (command === "search")
      result = await client.search({ q: required(argv.join(" "), "query"), limit: 50 });
    else if (command === "versions")
      result = await client.listVersions(required(argv[0], "file-id"));
    else if (command === "restore-version")
      result = await client.restoreVersion(
        required(argv[0], "file-id"),
        required(argv[1], "version-id"),
      );
    else if (command === "jobs") result = await client.listJobs({ limit: 50 });
    else if (command === "trash") result = await client.listTrash();
    else if (command === "share")
      result = await client.createShare({
        resourceType: "file",
        resourceId: required(argv[0], "file-id"),
        granteeEmail: required(takeOption(argv, "--email"), "email"),
        role: (takeOption(argv, "--role") ?? "viewer") as "viewer" | "editor",
      });
    else if (command === "public-link")
      result = await client.createPublicLink(required(argv[0], "file-id"));
    else if (command === "upload") {
      const path = resolve(required(argv[0], "path"));
      const info = await stat(path);
      const bytes = await readFile(path);
      const blob = new Blob([bytes]);
      const source: UploadSource = {
        name: basename(path),
        size: info.size,
        type: "application/octet-stream",
        slice: (s, e) => blob.slice(s, e),
      };
      result = await client.uploadFile(source, {
        folderId: takeOption(argv, "--folder") ?? (await client.getCurrentUser()).data.rootFolderId,
        signal,
        onProgress: (e) => {
          if (!json) io.err(`${e.status} ${e.percent}%`);
        },
      });
    } else if (command === "download") {
      const id = required(argv[0], "file-id"),
        output = resolve(takeOption(argv, "--output") ?? id);
      if (!takeFlag(argv, "--force"))
        await access(output)
          .then(() => {
            throw new Error(`Refusing to overwrite ${output}; use --force.`);
          })
          .catch((e) => {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
          });
      const download = await client.getDownloadUrl(id);
      const response = await fetch(download.data.url);
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      await writeFile(output, Buffer.from(await response.arrayBuffer()));
      result = { output };
    } else throw new Error(`Unknown command: ${command}`);
    io.out(json ? JSON.stringify(result) : format(result));
    return 0;
  } catch (error) {
    const code = error instanceof NimbusError ? error.code : "cli_error";
    const message = error instanceof Error ? error.message : "Nimbus command failed.";
    io.err(json ? JSON.stringify({ error: { code, message } }) : `${code}: ${message}`);
    return 1;
  }
}
function takeFlag(args: string[], flag: string) {
  const i = args.indexOf(flag);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
function takeOption(args: string[], flag: string) {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
}
function required(value: string | undefined, label: string) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}
function format(value: unknown) {
  return JSON.stringify(value, null, 2);
}
export const help = `Nimbus CLI
Commands: login, logout, whoami, ls, mkdir, upload, download, search, versions,
restore-version, share, public-link, jobs, trash
Global: --json`;
async function readSecret(prompt: string) {
  stdout.write(prompt);
  const mutedOutput = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({ input: stdin, output: mutedOutput, terminal: Boolean(stdin.isTTY) });
  try {
    return await rl.question("");
  } finally {
    rl.close();
    stdout.write("\n");
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  try {
    process.exitCode = await main(process.argv.slice(2), undefined, controller.signal);
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
