import type { AuthenticatedUser } from "@nimbus/auth";

export interface RequestContext {
  requestId: string;
  authenticatedUser?: AuthenticatedUser;
}

declare global {
  namespace Express {
    interface Request {
      context: RequestContext;
    }
  }
}
