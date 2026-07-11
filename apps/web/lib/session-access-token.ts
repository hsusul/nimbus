import { issueApiAccessToken, type AuthenticatedUser } from "@nimbus/auth";
import { getWebConfig } from "@nimbus/config";
import type { Session } from "next-auth";
import "server-only";

export async function accessTokenForSession(session: Session): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  const user = authenticatedUserFromSession(session);
  const config = getWebConfig();
  const now = new Date();
  const accessToken = await issueApiAccessToken(user, {
    secret: config.apiAuth.secret,
    issuer: config.apiAuth.issuer,
    audience: config.apiAuth.audience,
    expiresInSeconds: config.apiAuth.tokenTtlSeconds,
    now,
  });
  return {
    accessToken,
    expiresAt: new Date(now.getTime() + config.apiAuth.tokenTtlSeconds * 1000).toISOString(),
  };
}

export function authenticatedUserFromSession(session: Session): AuthenticatedUser {
  const user = session.user;
  if (!user?.authSubject || !user.email) {
    throw new Error("The authenticated session is missing required identity claims.");
  }
  return {
    authSubject: user.authSubject,
    email: user.email,
    displayName: user.name?.trim() || user.email,
    ...(user.image ? { avatarUrl: user.image } : {}),
  };
}
