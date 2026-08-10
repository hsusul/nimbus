const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|api[_-]?key|key[_-]?hash|signature|credential|signed[_-]?url|download[_-]?url|upload[_-]?url)/i;

const SENSITIVE_QUERY_PARAMS = new Set([
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-expires",
  "signature",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "api_key",
  "api-key",
  "apikey",
  "secret",
  "authorization",
  "password",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Redact `name=value` pairs for any sensitive parameter, wherever they appear
// in a string. Unlike `URL.searchParams`, this also covers URL fragments (e.g.
// OAuth `#access_token=...`) and strings that are not valid URLs, keeping the
// query-parameter allowlist and the free-text fallback from drifting apart.
const SENSITIVE_PARAM_PATTERN = new RegExp(
  `((?:${Array.from(SENSITIVE_QUERY_PARAMS, escapeRegExp).join("|")})=)[^&\\s]+`,
  "gi",
);

export type Redactable =
  null | undefined | string | number | boolean | Redactable[] | { [key: string]: Redactable };

export function redact(input: Redactable): Redactable {
  if (
    input === null ||
    input === undefined ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    return input;
  }

  if (typeof input === "string") {
    return redactString(input);
  }

  if (Array.isArray(input)) {
    return input.map((item) => redact(item));
  }

  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(value),
    ]),
  );
}

export function redactString(value: string): string {
  const scrubbed = redactEmbeddedSecrets(value).replace(SENSITIVE_PARAM_PATTERN, "$1[REDACTED]");

  try {
    const url = new URL(scrubbed);
    let changed = false;

    if (url.username) {
      url.username = "[REDACTED]";
      changed = true;
    }

    if (url.password) {
      url.password = "[REDACTED]";
      changed = true;
    }

    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[REDACTED]");
        changed = true;
      }
    }

    return changed ? url.toString() : scrubbed;
  } catch {
    return scrubbed;
  }
}

function redactEmbeddedSecrets(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\bnmb_live_[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}
