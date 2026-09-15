"use client";

import { PanelLeftOpen, PanelRightOpen } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ConversationSidebar } from "@/components/conversation-sidebar";
import { Transcript } from "@/components/transcript";
import type { ConversationDetail, WorkActivityGroup } from "@/components/types";
import {
  completeActivityGroup,
  createActivityGroup,
  failActivityGroup,
  projectWorkEvent,
  type WorkStreamEvent,
} from "@/components/work-activity";
import { WorkComposer } from "@/components/work-composer";
import { WorkOutputPanel } from "@/components/work-output-panel";
import { authClient } from "@/lib/auth-client";
import type {
  Conversation,
  ConversationMessage,
  ConversationOutput,
} from "@/lib/conversations";

export function WorkShell({
  initialConversations,
  user,
}: {
  initialConversations: Conversation[];
  user: { name: string; email: string };
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const activeRun = useRef<AbortController | null>(null);
  const [selectedId, setSelectedId] = useState(initialConversations[0]?.id ?? null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [outputs, setOutputs] = useState<ConversationOutput[]>([]);
  const [activityByConversation, setActivityByConversation] = useState<
    Record<string, WorkActivityGroup[]>
  >({});
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(Boolean(selectedId));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const refreshConversations = useCallback(async () => {
    const response = await fetch("/api/conversations");
    if (!response.ok) return;
    const payload = (await response.json()) as { conversations: Conversation[] };
    setConversations(payload.conversations);
  }, []);

  useEffect(() => {
    if (activeRun.current) return;
    if (!selectedId) {
      setMessages([]);
      setOutputs([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setError(null);
    const load = () => fetch(`/api/conversations/${selectedId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load this task");
        return response.json() as Promise<ConversationDetail>;
      })
      .then((detail) => {
        if (controller.signal.aborted || activeRun.current) return;
        setMessages(detail.messages);
        setOutputs(detail.outputs);
        setRunning(detail.conversation.status === "running");
        setConversations(current => current.map(row => row.id === detail.conversation.id ? detail.conversation : row));
        if (detail.conversation.status !== "running") setError(detail.conversation.error);
        if (detail.conversation.status === "running") timer = setTimeout(() => void load(), 2000);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(caught));
          timer = setTimeout(() => void load(), 5000);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selectedId, running]);

  async function cancelRun() {
    if (!selectedId) return;
    try {
      const response = await fetch(`/api/conversations/${selectedId}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error("Could not request cancellation; refresh the task status");
      activeRun.current?.abort();
      setError("Cancellation requested. Cleanup continues on the server.");
    } catch (caught) { setError(errorMessage(caught)); }
  }

  async function createTask(): Promise<string | null> {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/conversations", { method: "POST" });
      if (!response.ok) throw new Error("Could not create a task");
      const payload = (await response.json()) as { conversation: Conversation };
      setConversations((current) => [payload.conversation, ...current]);
      setSelectedId(payload.conversation.id);
      setMessages([]);
      setOutputs([]);
      return payload.conversation.id;
    } catch (caught) {
      setError(errorMessage(caught));
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function deleteTask(id: string) {
    if (!window.confirm("Delete this task and its sandbox?")) return;
    const response = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Could not delete this task");
      return;
    }
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    setActivityByConversation((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  }

  async function run() {
    const submittedPrompt = prompt.trim();
    if (!submittedPrompt || running) return;
    const conversationId = selectedId ?? (await createTask());
    if (!conversationId) return;
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    activeRun.current = controller;

    setPrompt("");
    setRunning(true);
    setConversations(current => current.map(row => row.id === conversationId ? { ...row, status: "running" } : row));
    setRightPanelOpen(true);
    setError(null);
    setActivityByConversation((current) =>
      updateConversationActivity(current, conversationId, (groups) => [
        ...groups,
        createActivityGroup(runId, submittedPrompt),
      ]),
    );
    try {
      const response = await fetch(`/api/conversations/${conversationId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: submittedPrompt }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Work request failed");
      }
      await readEvents(response.body, (payload) =>
        handleStreamEvent(payload, conversationId, runId),
      );
      await refreshConversations();
    } catch (caught) {
      const message = controller.signal.aborted ? "Work canceled. Saved outputs are retained." : errorMessage(caught);
      setError(message);
      setActivityByConversation((current) =>
        updateConversationActivity(current, conversationId, (groups) =>
          failActivityGroup(groups, runId, message),
        ),
      );
    } finally {
      activeRun.current = null;
      setRunning(false);
      await refreshConversations().catch(() => undefined);
    }
  }

  function handleStreamEvent(
    payload: StreamPayload,
    conversationId: string,
    runId: string,
  ) {
    if (payload.type === "message") {
      setMessages((current) =>
        current.some((message) => message.id === payload.message.id)
          ? current
          : [...current, payload.message],
      );
      return;
    }
    if (payload.type === "error") throw new Error(payload.error);
    if (payload.type === "complete") {
      setOutputs((current) => mergeOutputs(current, payload.result.outputs));
      setActivityByConversation((current) =>
        updateConversationActivity(current, conversationId, (groups) =>
          completeActivityGroup(groups, runId, payload.result.outputs),
        ),
      );
      return;
    }
    if (payload.type === "work") {
      if (payload.event.type === "output") {
        const output = payload.event.output;
        setOutputs((current) => mergeOutputs(current, [output]));
      }
      setActivityByConversation((current) =>
        updateConversationActivity(current, conversationId, (groups) =>
          projectWorkEvent(groups, runId, payload.event),
        ),
      );
    }
  }

  const hasConversationContent = messages.length > 0 || running || loading;
  const activityGroups = selectedId ? activityByConversation[selectedId] ?? [] : [];
  return (
    <main className={`work-app${leftPanelOpen ? "" : " left-closed"}${rightPanelOpen ? "" : " right-closed"}`}>
      {leftPanelOpen ? (
        <ConversationSidebar
          conversations={conversations}
          creating={creating}
          busy={running}
          selectedId={selectedId}
          user={user}
          onCreate={() => void createTask()}
          onClose={() => setLeftPanelOpen(false)}
          onDelete={(id) => void deleteTask(id)}
          onSelect={setSelectedId}
          onSignOut={() => void authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/sign-in") } })}
        />
      ) : null}
      <section className="workspace">
        <div className="workspace-panel-controls">
          {!leftPanelOpen ? (
            <button className="panel-toggle floating" type="button" onClick={() => setLeftPanelOpen(true)} aria-label="Open conversations">
              <PanelLeftOpen size={18} />
            </button>
          ) : <span />}
          {!rightPanelOpen ? (
            <button className="panel-toggle floating" type="button" onClick={() => setRightPanelOpen(true)} aria-label="Open work output">
              <PanelRightOpen size={18} />
            </button>
          ) : null}
        </div>
        {hasConversationContent ? (
          <>
            <div className="workspace-scroll">
              {loading ? <p className="loading-copy">Loading task…</p> : <Transcript messages={messages} />}
            </div>
            <WorkComposer
              onCancel={running ? () => void cancelRun() : undefined}
              disabled={running}
              prompt={prompt}
              onPromptChange={setPrompt}
              onSubmit={() => void run()}
            />
          </>
        ) : (
          <WorkComposer
            onCancel={running ? () => void cancelRun() : undefined}
            centered
            disabled={running || creating}
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={() => void run()}
          />
        )}
        {error ? <div className="error-toast" role="alert">{error}</div> : null}
      </section>
      {rightPanelOpen ? (
        <WorkOutputPanel
          groups={activityGroups}
          outputs={outputs}
          onClose={() => setRightPanelOpen(false)}
        />
      ) : null}
    </main>
  );
}

type StreamPayload =
  | { type: "message"; message: ConversationMessage }
  | { type: "work"; event: WorkStreamEvent }
  | { type: "complete"; result: { outputs: ConversationOutput[] } }
  | { type: "error"; error: string };

async function readEvents(
  stream: ReadableStream<Uint8Array>,
  receive: (payload: StreamPayload) => void,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) receive(JSON.parse(line) as StreamPayload);
  }
  if (buffer.trim()) receive(JSON.parse(buffer) as StreamPayload);
}

function updateConversationActivity(
  current: Record<string, WorkActivityGroup[]>,
  conversationId: string,
  update: (groups: WorkActivityGroup[]) => WorkActivityGroup[],
): Record<string, WorkActivityGroup[]> {
  return {
    ...current,
    [conversationId]: update(current[conversationId] ?? []),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mergeOutputs(
  current: ConversationOutput[],
  incoming: ConversationOutput[],
): ConversationOutput[] {
  const outputs = new Map(current.map((output) => [output.id, output]));
  for (const output of incoming) outputs.set(output.id, output);
  return [...outputs.values()];
}
