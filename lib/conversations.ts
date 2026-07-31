import "server-only";

import { randomUUID } from "node:crypto";

import { database } from "@/lib/database";

export type ConversationStatus = "idle" | "running" | "completed" | "failed";

export type Conversation = {
  id: string;
  title: string;
  sandboxId: string | null;
  status: ConversationStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type ConversationRow = {
  id: string;
  title: string;
  sandbox_id: string | null;
  status: ConversationStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

database.exec(`
  CREATE TABLE IF NOT EXISTS work_conversation (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    sandbox_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS work_conversation_user_updated
    ON work_conversation(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS work_message (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES work_conversation(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS work_message_conversation_created
    ON work_message(conversation_id, created_at ASC);
`);

export function listConversations(userId: string): Conversation[] {
  const rows = database
    .prepare(`
      SELECT id, title, sandbox_id, status, error, created_at, updated_at
      FROM work_conversation
      WHERE user_id = ?
      ORDER BY updated_at DESC
    `)
    .all(userId) as unknown as ConversationRow[];
  return rows.map(mapConversation);
}

export function createConversation(userId: string): Conversation {
  const now = new Date().toISOString();
  const row: ConversationRow = {
    id: randomUUID(),
    title: "New task",
    sandbox_id: null,
    status: "idle",
    error: null,
    created_at: now,
    updated_at: now,
  };
  database
    .prepare(`
      INSERT INTO work_conversation
        (id, user_id, title, sandbox_id, status, error, created_at, updated_at)
      VALUES (?, ?, ?, NULL, 'idle', NULL, ?, ?)
    `)
    .run(row.id, userId, row.title, now, now);
  return mapConversation(row);
}

export function getConversation(
  userId: string,
  conversationId: string,
): { conversation: Conversation; messages: ConversationMessage[] } | null {
  const row = database
    .prepare(`
      SELECT id, title, sandbox_id, status, error, created_at, updated_at
      FROM work_conversation
      WHERE id = ? AND user_id = ?
    `)
    .get(conversationId, userId) as unknown as ConversationRow | undefined;
  if (!row) return null;
  const messages = database
    .prepare(`
      SELECT id, role, content, created_at
      FROM work_message
      WHERE conversation_id = ? AND user_id = ?
      ORDER BY created_at ASC
    `)
    .all(conversationId, userId) as unknown as MessageRow[];
  return {
    conversation: mapConversation(row),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
  };
}

export function appendMessage(
  userId: string,
  conversationId: string,
  role: ConversationMessage["role"],
  content: string,
): ConversationMessage {
  const now = new Date().toISOString();
  const id = randomUUID();
  database.exec("BEGIN IMMEDIATE");
  try {
    const inserted = database
      .prepare(`
        INSERT INTO work_message (id, conversation_id, user_id, role, content, created_at)
        SELECT ?, id, user_id, ?, ?, ?
        FROM work_conversation
        WHERE id = ? AND user_id = ?
      `)
      .run(id, role, content, now, conversationId, userId);
    if (inserted.changes !== 1) throw new Error("Conversation not found");
    database
      .prepare(`
        UPDATE work_conversation
        SET title = CASE WHEN title = 'New task' AND ? = 'user' THEN ? ELSE title END,
            updated_at = ?
        WHERE id = ? AND user_id = ?
      `)
      .run(role, titleFromMessage(content), now, conversationId, userId);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return { id, role, content, createdAt: now };
}

export function updateConversationRun(
  userId: string,
  conversationId: string,
  input: {
    sandboxId?: string;
    clearSandbox?: boolean;
    status: ConversationStatus;
    error?: string | null;
  },
): void {
  const updated = database
    .prepare(`
      UPDATE work_conversation
      SET sandbox_id = CASE WHEN ? THEN NULL ELSE COALESCE(?, sandbox_id) END,
          status = ?, error = ?, updated_at = ?
      WHERE id = ? AND user_id = ?
    `)
    .run(
      input.clearSandbox ? 1 : 0,
      input.sandboxId ?? null,
      input.status,
      input.error ?? null,
      new Date().toISOString(),
      conversationId,
      userId,
    );
  if (updated.changes !== 1) throw new Error("Conversation not found");
}

export function deleteConversation(userId: string, conversationId: string): string | null {
  const row = database
    .prepare("SELECT sandbox_id FROM work_conversation WHERE id = ? AND user_id = ?")
    .get(conversationId, userId) as unknown as { sandbox_id: string | null } | undefined;
  if (!row) return null;
  database
    .prepare("DELETE FROM work_conversation WHERE id = ? AND user_id = ?")
    .run(conversationId, userId);
  return row.sandbox_id;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    sandboxId: row.sandbox_id,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function titleFromMessage(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 56 ? `${compact.slice(0, 55).trimEnd()}…` : compact || "New task";
}
