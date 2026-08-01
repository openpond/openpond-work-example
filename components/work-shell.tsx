"use client";

import type { OpenPondWorkEvent } from "openpond-sdk";
import { useCallback, useEffect, useState } from "react";

import { ConversationSidebar } from "@/components/conversation-sidebar";
import { Transcript } from "@/components/transcript";
import type { ActivityRow, ConversationDetail } from "@/components/types";
import { WorkComposer } from "@/components/work-composer";
import { authClient } from "@/lib/auth-client";
import type { Conversation, ConversationMessage } from "@/lib/conversations";

export function WorkShell({
  initialConversations,
  user,
}: {
  initialConversations: Conversation[];
  user: { name: string; email: string };
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState(initialConversations[0]?.id ?? null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(Boolean(selectedId));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    const response = await fetch("/api/conversations");
    if (!response.ok) return;
    const payload = (await response.json()) as { conversations: Conversation[] };
    setConversations(payload.conversations);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(`/api/conversations/${selectedId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load this task");
        return response.json() as Promise<ConversationDetail>;
      })
      .then((detail) => {
        setMessages(detail.messages);
        setRunning(detail.conversation.status === "running");
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorMessage(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

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
      setActivity([]);
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
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  }

  async function run() {
    const submittedPrompt = prompt.trim();
    if (!submittedPrompt || running) return;
    const conversationId = selectedId ?? (await createTask());
    if (!conversationId) return;

    setPrompt("");
    setRunning(true);
    setError(null);
    setActivity([{ id: "starting", label: "Preparing sandbox", state: "active" }]);
    try {
      const response = await fetch(`/api/conversations/${conversationId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: submittedPrompt, repo: repo.trim() || undefined }),
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "Work request failed");
      }
      await readEvents(response.body, handleStreamEvent);
      await refreshConversations();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      setActivity((current) => [
        ...current.filter((row) => row.state !== "active"),
        { id: `error-${Date.now()}`, label: message, state: "error" },
      ]);
    } finally {
      setRunning(false);
    }
  }

  function handleStreamEvent(payload: StreamPayload) {
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
      setActivity((current) => current.map((row) => ({ ...row, state: "success" })));
      return;
    }
    if (payload.type === "work") projectWorkEvent(payload.event, setActivity);
  }

  const hasConversationContent = messages.length > 0 || running || loading;
  return (
    <main className="work-app">
      <ConversationSidebar
        conversations={conversations}
        creating={creating}
        selectedId={selectedId}
        user={user}
        onCreate={() => void createTask()}
        onDelete={(id) => void deleteTask(id)}
        onSelect={(id) => {
          setSelectedId(id);
          setActivity([]);
        }}
        onSignOut={() => void authClient.signOut({ fetchOptions: { onSuccess: () => location.assign("/sign-in") } })}
      />
      <section className="workspace">
        {hasConversationContent ? (
          <>
            <div className="workspace-scroll">
              {loading ? <p className="loading-copy">Loading task…</p> : <Transcript messages={messages} activity={activity} />}
            </div>
            <WorkComposer
              disabled={running}
              prompt={prompt}
              repo={repo}
              onPromptChange={setPrompt}
              onRepoChange={setRepo}
              onSubmit={() => void run()}
            />
          </>
        ) : (
          <WorkComposer
            centered
            disabled={running || creating}
            prompt={prompt}
            repo={repo}
            onPromptChange={setPrompt}
            onRepoChange={setRepo}
            onSubmit={() => void run()}
          />
        )}
        {error ? <div className="error-toast" role="alert">{error}</div> : null}
      </section>
    </main>
  );
}

type StreamPayload =
  | { type: "message"; message: ConversationMessage }
  | { type: "work"; event: OpenPondWorkEvent }
  | { type: "complete"; result: unknown }
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

function projectWorkEvent(
  event: OpenPondWorkEvent,
  setActivity: React.Dispatch<React.SetStateAction<ActivityRow[]>>,
) {
  if (event.type === "status") {
    setActivity((current) => [
      ...current.map((row) => (row.state === "active" ? { ...row, state: "success" as const } : row)),
      { id: `status-${Date.now()}`, label: event.message, state: "active" },
    ]);
  } else if (event.type === "sandbox") {
    setActivity((current) => [
      ...current.filter((row) => row.id !== "sandbox"),
      {
        id: "sandbox",
        label: `Sandbox ${event.state}`,
        detail: event.sandboxId,
        state: "success",
      },
    ]);
  } else if (event.type === "tool") {
    const row: ActivityRow = {
      id: event.toolCallId,
      label: event.status === "started" ? "Running command" : `Ran ${event.command}`,
      detail: event.status === "started" ? event.command : summarizeOutput(event.output),
      state: event.status === "started" ? "active" : event.status === "succeeded" ? "success" : "error",
    };
    setActivity((current) => [...current.filter((item) => item.id !== row.id), row]);
  }
}

function summarizeOutput(output?: string): string | undefined {
  const compact = output?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 160 ? `${compact.slice(0, 159)}…` : compact;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
