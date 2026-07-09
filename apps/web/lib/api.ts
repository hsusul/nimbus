import { getWebConfig } from "@nimbus/config";

export interface ApiHealth {
  status: "ok" | "unavailable";
  service?: string;
}

export async function getApiHealth(): Promise<ApiHealth> {
  const config = getWebConfig();

  try {
    const response = await fetch(`${config.apiBaseUrl}/health`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        status: "unavailable",
      };
    }

    const body = (await response.json()) as { data?: { status?: string; service?: string } };

    return {
      status: body.data?.status === "ok" ? "ok" : "unavailable",
      service: body.data?.service,
    };
  } catch {
    return {
      status: "unavailable",
    };
  }
}
