const apiBaseUrl = requiredHttpsUrl("PRODUCTION_API_URL");
const webBaseUrl = optionalHttpsUrl("PRODUCTION_WEB_URL");

type Check = { name: string; run: () => Promise<void> };

const checks: Check[] = [
  { name: "API health", run: () => expectJson("/health", 200) },
  { name: "API readiness", run: () => expectReady() },
  { name: "OpenAPI", run: () => expectOpenApi() },
  { name: "security headers", run: () => expectSecurityHeaders() },
  { name: "development authentication rejected", run: () => expectDevAuthRejected() },
];

if (webBaseUrl) checks.push({ name: "web availability", run: () => expectWebAvailable() });

let failed = false;
for (const check of checks) {
  try {
    await check.run();
    console.log(`PASS ${check.name}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL ${check.name}: ${safeMessage(error)}`);
  }
}

if (failed) process.exitCode = 1;

async function expectJson(path: string, expectedStatus: number) {
  const response = await fetch(new URL(path, apiBaseUrl), { redirect: "error" });
  if (response.status !== expectedStatus) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("response is not JSON");
  await response.json();
}

async function expectReady() {
  const response = await fetch(new URL("/ready", apiBaseUrl), { redirect: "error" });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as {
    data?: { status?: string; dependencies?: { postgres?: boolean; redis?: boolean } };
  };
  if (
    body.data?.status !== "ready" ||
    body.data.dependencies?.postgres !== true ||
    body.data.dependencies?.redis !== true
  ) {
    throw new Error("managed dependency readiness was not confirmed");
  }
}

async function expectOpenApi() {
  const response = await fetch(new URL("/api/v1/openapi.json", apiBaseUrl), { redirect: "error" });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as { openapi?: string; paths?: Record<string, unknown> };
  if (body.openapi !== "3.0.3" || !body.paths?.["/health"] || !body.paths?.["/ready"]) {
    throw new Error("unexpected OpenAPI document");
  }
}

async function expectSecurityHeaders() {
  const response = await fetch(new URL("/health", apiBaseUrl), { redirect: "error" });
  for (const name of [
    "content-security-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "x-request-id",
  ]) {
    if (!response.headers.get(name)) throw new Error(`missing ${name}`);
  }
}

async function expectDevAuthRejected() {
  const response = await fetch(new URL("/api/v1/me", apiBaseUrl), {
    redirect: "error",
    headers: {
      "x-nimbus-user": "production-smoke-dev-auth-must-fail",
      "x-nimbus-email": "production-smoke@example.invalid",
    },
  });
  if (response.status !== 401) throw new Error(`expected HTTP 401, received ${response.status}`);
}

async function expectWebAvailable() {
  const response = await fetch(webBaseUrl!, { redirect: "manual" });
  if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
}

function requiredHttpsUrl(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return parseHttpsUrl(value, name);
}

function optionalHttpsUrl(name: string) {
  const value = process.env[name];
  return value ? parseHttpsUrl(value, name) : undefined;
}

function parseHttpsUrl(value: string, name: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS.`);
  return url;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
