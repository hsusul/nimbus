import { getWebConfig } from "@nimbus/config";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "../../../../auth";
import { accessTokenForSession } from "../../../../lib/session-access-token";

export async function GET() {
  const config = getWebConfig();
  if (config.authMode !== "authjs") {
    return NextResponse.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    );
  }
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json(
      { error: { code: "unauthenticated", message: "Authentication is required." } },
      { status: 401 },
    );
  }
  try {
    const data = await accessTokenForSession(session);
    return NextResponse.json(
      { data },
      {
        headers: {
          "cache-control": "no-store, private",
          pragma: "no-cache",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_session", message: "The session identity is incomplete." } },
      { status: 401 },
    );
  }
}
