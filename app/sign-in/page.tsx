import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  if (await currentSession()) redirect("/");
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="brand-mark" aria-hidden="true">O</div>
        <h1>OpenPond Work</h1>
        <p>Run focused agentic work in a persistent OpenPond sandbox.</p>
        <AuthForm />
      </section>
    </main>
  );
}
