import { getWebConfig } from "@nimbus/config";
import { headers } from "next/headers";
import "server-only";

import type { ApiClientConfig } from "./api-client";

export async function getConsoleConfig(): Promise<ApiClientConfig> {
  const config = getWebConfig();
  if (config.nodeEnv === "production") {
    return { apiBaseUrl: config.apiBaseUrl, devAuth: null };
  }
  const requestHeaders = await headers();
  const requestUser = requestHeaders.get("x-nimbus-dev-user");
  return {
    apiBaseUrl: config.apiBaseUrl,
    devAuth: requestUser
      ? {
          user: requestUser,
          email: requestHeaders.get("x-nimbus-dev-email") ?? undefined,
          name: requestHeaders.get("x-nimbus-dev-name") ?? undefined,
        }
      : config.devAuth,
  };
}
