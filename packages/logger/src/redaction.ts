const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|api[_-]?key|signature|credential|signed[_-]?url|download[_-]?url|upload[_-]?url)/i;

const SENSITIVE_QUERY_PARAMS = new Set([
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-expires",
  "signature",
  "token",
  "access_token",
  "api_key",
]);

export type Redactable =
  null | string | number | boolean | Redactable[] | { [key: string]: Redactable };

export function redact(input: Redactable): Redactable {
  if (input === null || typeof input === "number" || typeof input === "boolean") {
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
  try {
    const url = new URL(value);
    let changed = false;

    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        url.searchParams.set(key, "[REDACTED]");
        changed = true;
      }
    }

    return changed ? url.toString() : value;
  } catch {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
      .replace(/((?:token|secret|signature|api[_-]?key)=)[^&\s]+/gi, "$1[REDACTED]");
  }
}
