import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DEMO_IDS } from "./demo-data";

const baseUrl = process.env.LOAD_API_BASE_URL ?? "http://localhost:4000";
const duration = positiveInteger(process.env.LOAD_DURATION_SECONDS, 5);
const connections = positiveInteger(process.env.LOAD_CONNECTIONS, 5);
const outputPath = resolve(process.env.LOAD_OUTPUT_PATH ?? "tmp/m10-load-results.json");
const demoHeaders = {
  "x-nimbus-dev-user": "nimbus-demo",
  "x-nimbus-dev-email": "demo.owner@example.test",
  "x-nimbus-dev-name": "Nimbus Demo",
};

const scenarios = [
  { name: "health", path: "/health", authenticated: false },
  { name: "readiness", path: "/ready", authenticated: false },
  {
    name: "folder-children",
    path: `/api/v1/folders/${DEMO_IDS.ownerRoot}/children?limit=50`,
    authenticated: true,
  },
  {
    name: "file-list",
    path: `/api/v1/files?folderId=${DEMO_IDS.sharedFolder}&limit=50`,
    authenticated: true,
  },
  { name: "search", path: "/api/v1/search?q=Launch&limit=20", authenticated: true },
  {
    name: "download-url",
    path: `/api/v1/files/${DEMO_IDS.sharedFile}/download`,
    authenticated: true,
  },
  { name: "job-list", path: "/api/v1/jobs?limit=20", authenticated: true },
] as const;

const selectedNames = new Set(
  (process.env.LOAD_SCENARIOS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const selected = selectedNames.size
  ? scenarios.filter((scenario) => selectedNames.has(scenario.name))
  : scenarios;

if (selected.length === 0) throw new Error("No matching load scenarios were selected.");

const startedAt = new Date().toISOString();
const results = [];
for (const scenario of selected) {
  results.push(await runScenario(scenario));
}

const report = {
  environment: "local synthetic demo dataset; API bytes are not transferred",
  startedAt,
  durationSecondsPerScenario: duration,
  concurrency: connections,
  scenarios: results,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const result of results) {
  process.stdout.write(
    `${result.name}: requests=${result.requests} p50=${result.p50Ms}ms p95=${result.p95Ms}ms p99=${result.p99Ms}ms errors=${result.errors} non2xx=${result.non2xx}\n`,
  );
}
process.stdout.write(`Report: ${outputPath}\n`);

if (results.some((result) => result.errors > 0 || result.non2xx > 0)) process.exitCode = 1;

async function runScenario(scenario: (typeof scenarios)[number]) {
  const url = new URL(scenario.path, baseUrl);
  const deadline = performance.now() + duration * 1000;
  const latencies: number[] = [];
  let errors = 0;
  let non2xx = 0;
  let timeouts = 0;

  await Promise.all(
    Array.from({ length: connections }, async () => {
      while (performance.now() < deadline) {
        const started = performance.now();
        try {
          const response = await fetch(url, {
            headers: scenario.authenticated ? demoHeaders : undefined,
            signal: AbortSignal.timeout(10_000),
          });
          await response.arrayBuffer();
          if (!response.ok) non2xx += 1;
        } catch (error) {
          errors += 1;
          if (error instanceof DOMException && error.name === "TimeoutError") timeouts += 1;
        } finally {
          latencies.push(performance.now() - started);
        }
      }
    }),
  );
  latencies.sort((left, right) => left - right);

  return {
    name: scenario.name,
    requests: latencies.length,
    requestsPerSecond: round(latencies.length / duration),
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    errors,
    timeouts,
    non2xx,
  };
}

function percentile(sorted: number[], value: number) {
  if (sorted.length === 0) return 0;
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)]!);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function positiveInteger(raw: string | undefined, fallback: number) {
  const value = Number(raw ?? fallback);
  if (!Number.isInteger(value) || value < 1)
    throw new Error("Load settings must be positive integers.");
  return value;
}
