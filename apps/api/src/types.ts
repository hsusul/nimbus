import type { AuthenticatedUser } from "@nimbus/auth";
import type { ApiKeyScope } from "@nimbus/contracts";

export interface RequestContext {
  requestId: string;
  authenticatedUser?: AuthenticatedUser;
  authentication?:
    | { type: "browser_token" | "development" }
    | { type: "api_key"; apiKeyId: string; scopes: ApiKeyScope[] };
}

declare global {
  namespace Express {
    interface Request {
      context: RequestContext;
    }
  }
}
