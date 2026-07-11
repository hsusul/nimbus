import { getWebConfig } from "@nimbus/config";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import "server-only";

import { authOptions } from "../auth";
import type { ApiClientConfig } from "./api-client";
import { accessTokenForSession } from "./session-access-token";

export async function getConsoleConfig(): Promise<ApiClientConfig> {
  const config = getWebConfig();
  if (config.authMode === "authjs") {
    const session = await getServerSession(authOptions);
    if (!session) redirect("/sign-in");
    const { accessToken } = await accessTokenForSession(session);
    return {
      apiBaseUrl: config.apiBaseUrl,
      devAuth: null,
      accessToken,
      accessTokenEndpoint: "/api/internal/access-token",
      productionAuth: true,
    };
  }
  const requestHeaders = await headers();
  const requestUser = requestHeaders.get("x-nimbus-dev-user");
  return {
    apiBaseUrl: config.apiBaseUrl,
    accessToken: null,
    accessTokenEndpoint: null,
    productionAuth: false,
    devAuth: requestUser
      ? {
          user: requestUser,
          email: requestHeaders.get("x-nimbus-dev-email") ?? undefined,
          name: requestHeaders.get("x-nimbus-dev-name") ?? undefined,
        }
      : config.devAuth,
  };
}
