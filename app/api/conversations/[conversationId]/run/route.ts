import {
  OpenPondNonExecutingSandboxError,
  type OpenPondWorkEvent,
} from "openpond-sdk";

import {
  appendMessage,
  getConversation,
  updateConversationRun,
} from "@/lib/conversations";
import { openPondClient } from "@/lib/openpond";
import { requireApiSession } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 800;

type Context = { params: Promise<{ conversationId: string }> };

export async function POST(request: Request, context: Context) {
  const session = await requireApiSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { conversationId } = await context.params;
  const existing = getConversation(session.user.id, conversationId);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });
  if (existing.conversation.status === "running") {
    return Response.json({ error: "Conversation is already running" }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as {
    prompt?: unknown;
    repo?: unknown;
  } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const repo = typeof body?.repo === "string" ? body.repo.trim() : "";
  if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });

  const userMessage = appendMessage(session.user.id, conversationId, "user", prompt);
  updateConversationRun(session.user.id, conversationId, { status: "running" });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        try {
          send({ type: "message", message: userMessage });
          const result = await openPondClient().work.run({
            prompt,
            repo: repo || undefined,
            sandboxId: existing.conversation.sandboxId || undefined,
            history: existing.messages.map(({ role, content }) => ({ role, content })),
            signal: request.signal,
            metadata: { conversationId, userId: session.user.id },
            onEvent: async (event: OpenPondWorkEvent) => {
              if (event.type === "sandbox") {
                updateConversationRun(session.user.id, conversationId, {
                  sandboxId: event.sandboxId,
                  status: "running",
                });
              }
              send({ type: "work", event });
            },
          });
          const assistantMessage = appendMessage(
            session.user.id,
            conversationId,
            "assistant",
            result.text || "Work completed.",
          );
          updateConversationRun(session.user.id, conversationId, {
            sandboxId: result.sandboxId,
            status: "completed",
          });
          send({ type: "message", message: assistantMessage });
          send({ type: "complete", result });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          updateConversationRun(session.user.id, conversationId, {
            status: "failed",
            error: message,
            clearSandbox: error instanceof OpenPondNonExecutingSandboxError,
          });
          send({ type: "error", error: message });
        } finally {
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
