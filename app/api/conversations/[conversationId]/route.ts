import {
  completeSandboxCleanup,
  deleteConversation,
  enqueueSandboxCleanup,
  getConversation,
  listStoredConversationOutputs,
} from "@/lib/conversations";
import { openPondClient } from "@/lib/openpond";
import { retryPendingSandboxCleanups } from "@/lib/sandbox-cleanup";
import { requireApiSession } from "@/lib/session";
import { workOutputStore } from "@/lib/work-output-store";

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
  if (existing.conversation.status === "running") {
    return Response.json({ error: "Cancel Work and wait for cleanup before deleting this task" }, { status: 409 });
  }
  const storedOutputs = listStoredConversationOutputs(
    session.user.id,
    conversationId,
  );
  await retryPendingSandboxCleanups();
  const sandboxId = existing.conversation.sandboxId;
  if (sandboxId) {
    enqueueSandboxCleanup(session.user.id, conversationId, sandboxId);
    try {
      await openPondClient().work.deleteSandbox(sandboxId);
      completeSandboxCleanup(sandboxId);
    } catch (error) {
      enqueueSandboxCleanup(
        session.user.id,
        conversationId,
        sandboxId,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  await Promise.all(
    storedOutputs.map((output) => workOutputStore().delete(output.storageKey)),
  );
  deleteConversation(session.user.id, conversationId);
  return new Response(null, { status: 204 });
}
