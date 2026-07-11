import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user?: DefaultSession["user"] & {
      authSubject: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    authSubject?: string;
  }
}
