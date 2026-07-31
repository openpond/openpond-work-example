import { redirect } from "next/navigation";

import { WorkShell } from "@/components/work-shell";
import { listConversations } from "@/lib/conversations";
import { currentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await currentSession();
  if (!session) redirect("/sign-in");
  return (
    <WorkShell
      initialConversations={listConversations(session.user.id)}
      user={{ name: session.user.name, email: session.user.email }}
    />
  );
}
