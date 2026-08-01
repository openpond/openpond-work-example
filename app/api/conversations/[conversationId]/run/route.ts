import { createHash } from "node:crypto";

import type {
  OpenPondWorkEvent,
  OpenPondWorkInputFile,
} from "openpond-sdk";

import {
  appendMessage,
  enqueueSandboxCleanup,
  finalizeConversationOutput,
  getConversation,
  listStoredConversationOutputs,
  reserveConversationOutput,
  updateConversationRun,
} from "@/lib/conversations";
import { openPondClient } from "@/lib/openpond";
import { retryPendingSandboxCleanups } from "@/lib/sandbox-cleanup";
import { requireApiSession } from "@/lib/session";
import { workOutputStore } from "@/lib/work-output-store";

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
  } | null;
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 });

  await retryPendingSandboxCleanups();
  const priorInputs = await durableConversationInputs(
    conversationId,
    listStoredConversationOutputs(session.user.id, conversationId),
  );

  const userMessage = appendMessage(session.user.id, conversationId, "user", prompt);
  updateConversationRun(session.user.id, conversationId, { status: "running" });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      void (async () => {
        let activeSandboxId: string | null = null;
        let finalAssistantText = "";
        let assistantMessageCommitted = false;
        const persistedOutputs = new Map<
          string,
          ReturnType<typeof finalizeConversationOutput>
        >();
        try {
          send({ type: "message", message: userMessage });
          const result = await openPondClient().work.run({
            prompt,
            history: existing.messages.map(({ role, content }) => ({ role, content })),
            inputs: priorInputs,
            cleanup: "delete",
            signal: request.signal,
            metadata: { conversationId, userId: session.user.id },
            persistOutput: async ({ output, download }) => {
              if (!activeSandboxId) throw new Error("Work output has no sandbox");
              const reservation = reserveConversationOutput(
                session.user.id,
                conversationId,
                activeSandboxId,
                output,
              );
              if (reservation.finalized) {
                const current = getConversation(session.user.id, conversationId)?.outputs.find(
                  (candidate) => candidate.id === reservation.id,
                );
                if (current) persistedOutputs.set(current.id, current);
                return;
              }
              let storageKey: string | null = null;
              try {
                const response = await download();
                const bytes = Buffer.from(response.file.contentsBase64, "base64");
                const stored = await workOutputStore().put({
                  ownerId: session.user.id,
                  conversationId,
                  outputId: reservation.id,
                  name: output.name,
                  mimeType: output.mimeType,
                  expectedSizeBytes: output.sizeBytes,
                  bytes,
                });
                storageKey = stored.storageKey;
                const finalized = finalizeConversationOutput(
                  session.user.id,
                  conversationId,
                  reservation.id,
                  stored,
                );
                persistedOutputs.set(finalized.id, finalized);
                send({ type: "work", event: { type: "output", output: finalized } });
              } catch (error) {
                if (storageKey) await workOutputStore().delete(storageKey).catch(() => undefined);
                throw error;
              }
            },
            onEvent: async (event: WorkStreamEvent) => {
              if (event.type === "sandbox") {
                activeSandboxId = event.sandboxId;
                updateConversationRun(session.user.id, conversationId, {
                  sandboxId: event.sandboxId,
                  status: "running",
                });
              }
              if (event.type === "assistant") {
                finalAssistantText = event.text;
              }
              if (event.type === "cleanup" && event.status === "started") {
                if (!assistantMessageCommitted) {
                  const assistantMessage = appendMessage(
                    session.user.id,
                    conversationId,
                    "assistant",
                    finalAssistantText || "Work completed.",
                  );
                  assistantMessageCommitted = true;
                  updateConversationRun(session.user.id, conversationId, {
                    status: "completed",
                  });
                  send({ type: "message", message: assistantMessage });
                }
              }
              if (event.type === "output") {
                return;
              }
              if (
                event.type === "cleanup" &&
                (event.status === "pending" || event.status === "failed") &&
                activeSandboxId
              ) {
                enqueueSandboxCleanup(
                  session.user.id,
                  conversationId,
                  activeSandboxId,
                  "error" in event ? event.error : undefined,
                );
              }
              send({ type: "work", event });
            },
          });
          if (!assistantMessageCommitted) {
            const assistantMessage = appendMessage(
              session.user.id,
              conversationId,
              "assistant",
              result.text || "Work completed.",
            );
            send({ type: "message", message: assistantMessage });
          }
          updateConversationRun(session.user.id, conversationId, {
            clearSandbox: true,
            status: "completed",
          });
          send({
            type: "complete",
            result: { ...result, outputs: [...persistedOutputs.values()] },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (activeSandboxId) {
            const lifecycle = workLifecycle(error);
            if (
              lifecycle?.cleanup?.status === "failed" ||
              lifecycle?.persistence?.status === "failed"
            ) {
              enqueueSandboxCleanup(
                session.user.id,
                conversationId,
                activeSandboxId,
                lifecycle.cleanup?.error ?? lifecycle.persistence?.error ?? message,
              );
            }
          }
          updateConversationRun(session.user.id, conversationId, {
            clearSandbox: true,
            status: "failed",
            error: message,
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

type WorkStreamEvent = OpenPondWorkEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function durableConversationInputs(
  conversationId: string,
  outputs: Array<{
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    storageKey: string;
    sha256: string;
    revision: number;
  }>,
): Promise<OpenPondWorkInputFile[]> {
  const latestByName = new Map<string, (typeof outputs)[number]>();
  for (const output of outputs) {
    const current = latestByName.get(output.name);
    if (!current || output.revision > current.revision) {
      latestByName.set(output.name, output);
    }
  }
  return Promise.all(
    [...latestByName.values()].map(async (output) => {
      const bytes = await workOutputStore().get(output.storageKey);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== output.sizeBytes || sha256 !== output.sha256) {
        throw new Error(`Saved output failed verification: ${output.name}`);
      }
      return {
        id: output.id,
        name: output.name,
        contentsBase64: Buffer.from(bytes).toString("base64"),
        mimeType: output.mimeType,
        checksumSha256: output.sha256,
        revision: output.revision,
        metadata: { conversationId, outputId: output.id },
      };
    }),
  );
}

function workLifecycle(error: unknown): {
  cleanup?: { status?: string; error?: string };
  persistence?: { status?: string; error?: string };
} | null {
  if (!isRecord(error) || !isRecord(error.workLifecycle)) return null;
  return error.workLifecycle;
}
