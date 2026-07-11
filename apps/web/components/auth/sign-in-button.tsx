"use client";

import { LogIn } from "lucide-react";
import { signIn } from "next-auth/react";

import { Button } from "../ui/button";

export function SignInButton() {
  return (
    <Button onClick={() => void signIn("github", { callbackUrl: "/files" })}>
      <LogIn aria-hidden="true" size={18} /> Continue with GitHub
    </Button>
  );
}
