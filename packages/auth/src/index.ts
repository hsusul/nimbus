export interface AuthenticatedUser {
  authSubject: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

export interface DevAuthOptions {
  enabled: boolean;
}

export type HeaderBag = Record<string, string | string[] | undefined>;

export function resolveDevUser(
  headers: HeaderBag,
  options: DevAuthOptions,
): AuthenticatedUser | null {
  if (!options.enabled) {
    return null;
  }

  const rawUser = getHeader(headers, "x-nimbus-dev-user");

  if (!rawUser) {
    return null;
  }

  const slug = rawUser.trim().toLowerCase();

  if (!/^[a-z0-9._-]{1,64}$/.test(slug)) {
    return null;
  }

  return {
    authSubject: `dev:${slug}`,
    email: getHeader(headers, "x-nimbus-dev-email") ?? `${slug}@nimbus.local`,
    displayName: getHeader(headers, "x-nimbus-dev-name") ?? titleize(slug),
  };
}

export function isAuthJsConfigured(): boolean {
  return false;
}

function getHeader(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function titleize(value: string): string {
  return value
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
