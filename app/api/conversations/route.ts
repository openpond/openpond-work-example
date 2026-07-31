import { createConversation, listConversations } from "@/lib/conversations";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireApiSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ conversations: listConversations(session.user.id) });
}

export async function POST() {
  const session = await requireApiSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(
    { conversation: createConversation(session.user.id) },
    { status: 201 },
  );
}
