import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { OpenPondLogo } from "@/components/openpond-logo";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await currentSession()) redirect("/");
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <OpenPondLogo />
        <h1>OpenPond Work</h1>
        <p>Run focused agentic work in a persistent OpenPond sandbox.</p>
        <AuthForm />
      </section>
    </main>
  );
}
