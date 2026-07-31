import {
  deleteConversation,
  getConversation,
} from "@/lib/conversations";
import { openPondClient } from "@/lib/openpond";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";

type Context = { params: Promise<{ conversationId: string }> };

export async function GET(_request: Request, context: Context) {
  const session = await requireApiSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await context.params;
  const result = getConversation(session.user.id, conversationId);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(result);
}

export async function DELETE(_request: Request, context: Context) {
  const session = await requireApiSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await context.params;
  const existing = getConversation(session.user.id, conversationId);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  const sandboxId = deleteConversation(session.user.id, conversationId);
  if (sandboxId) {
    await openPondClient().work.deleteSandbox(sandboxId).catch(() => undefined);
  }
  return new Response(null, { status: 204 });
}
