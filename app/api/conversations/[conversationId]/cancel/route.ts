import { getConversation } from "@/lib/conversations";
import { requireApiSession } from "@/lib/session";
import { cancelWorkRun } from "@/lib/work-runs";

export const runtime = "nodejs";
export async function POST(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
  const session = await requireApiSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await context.params;
  const current = getConversation(session.user.id, conversationId);
  if (!current) return Response.json({ error: "Not found" }, { status: 404 });
  if (current.conversation.status !== "running") return Response.json({ status: "finished" });
  if (!cancelWorkRun(session.user.id, conversationId))
    return Response.json({ error: "Work is recovering; refresh its status shortly" }, { status: 409 });
  return Response.json({ status: "cancelling" }, { status: 202 });
}
