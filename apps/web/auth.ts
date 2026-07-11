import { getWebConfig, type WebConfig } from "@nimbus/config";
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";

export function createAuthOptions(config: WebConfig): NextAuthOptions {
  return {
    secret: config.auth.secret || "local-authjs-disabled-secret-0000000000000000",
    useSecureCookies: config.deploymentProfile === "production",
    session: {
      strategy: "jwt",
      maxAge: config.auth.sessionMaxAgeSeconds,
    },
    pages: {
      signIn: "/sign-in",
    },
    providers:
      config.authMode === "authjs" && config.auth.githubId && config.auth.githubSecret
        ? [
            GitHubProvider({
              clientId: config.auth.githubId,
              clientSecret: config.auth.githubSecret,
            }),
          ]
        : [],
    callbacks: {
      async jwt({ token, account }) {
        if (account) token.authSubject = `${account.provider}:${account.providerAccountId}`;
        return token;
      },
      async session({ session, token }) {
        if (session.user && typeof token.authSubject === "string") {
          session.user.authSubject = token.authSubject;
        }
        return session;
      },
    },
  };
}

export const authOptions = createAuthOptions(getWebConfig());
