import { Cloud } from "lucide-react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "../../auth";
import { SignInButton } from "../../components/auth/sign-in-button";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getServerSession(authOptions)) redirect("/files");
  return (
    <main className="auth-page">
      <section className="auth-panel" aria-labelledby="sign-in-title">
        <span className="brand-mark auth-panel__mark" aria-hidden="true">
          <Cloud size={28} strokeWidth={2.2} />
        </span>
        <p className="auth-panel__brand">Nimbus</p>
        <h1 id="sign-in-title">Sign in to your workspace</h1>
        <p>Use your GitHub account to access files, versions, shares, and background jobs.</p>
        <SignInButton />
      </section>
    </main>
  );
}
