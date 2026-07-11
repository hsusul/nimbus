import { jwtVerify, SignJWT } from "jose";

export interface AuthenticatedUser {
  authSubject: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
}

export interface DevAuthOptions {
  enabled: boolean;
}

export interface ApiAccessTokenOptions {
  secret: string;
  issuer: string;
  audience: string;
  expiresInSeconds: number;
  now?: Date;
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

export async function issueApiAccessToken(
  user: AuthenticatedUser,
  options: ApiAccessTokenOptions,
): Promise<string> {
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  return new SignJWT({
    email: user.email,
    name: user.displayName,
    avatarUrl: user.avatarUrl,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.authSubject)
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + options.expiresInSeconds)
    .sign(secretKey(options.secret));
}

export async function verifyApiAccessToken(
  token: string,
  options: Omit<ApiAccessTokenOptions, "expiresInSeconds">,
): Promise<AuthenticatedUser> {
  const { payload } = await jwtVerify(token, secretKey(options.secret), {
    algorithms: ["HS256"],
    issuer: options.issuer,
    audience: options.audience,
    currentDate: options.now,
  });
  if (
    !payload.sub ||
    typeof payload.email !== "string" ||
    typeof payload.name !== "string" ||
    (payload.avatarUrl !== undefined && typeof payload.avatarUrl !== "string")
  ) {
    throw new Error("API access token is missing required identity claims.");
  }
  return {
    authSubject: payload.sub,
    email: payload.email,
    displayName: payload.name,
    ...(payload.avatarUrl ? { avatarUrl: payload.avatarUrl } : {}),
  };
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

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}
