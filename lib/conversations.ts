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

export type ConversationOutput = {
  id: string;
  conversationId: string;
  sandboxId: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  revision: number;
  updatedAt: string;
  createdAt: string;
  downloadUrl: string;
};

export type StoredConversationOutput = ConversationOutput & {
  storageKey: string;
  sha256: string;
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

type OutputRow = {
  id: string;
  conversation_id: string;
  sandbox_id: string;
  path: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_key: string | null;
  sha256: string | null;
  revision: number;
  finalized: number;
  updated_at: string;
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
  CREATE TABLE IF NOT EXISTS work_output (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES work_conversation(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    sandbox_id TEXT NOT NULL,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_key TEXT,
    sha256 TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    finalized INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(conversation_id, path, updated_at)
  );
  CREATE INDEX IF NOT EXISTS work_output_conversation_created
    ON work_output(conversation_id, created_at ASC);
  CREATE TABLE IF NOT EXISTS work_sandbox_cleanup (
    sandbox_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS work_sandbox_cleanup_due
    ON work_sandbox_cleanup(status, next_attempt_at ASC);
`);

ensureColumn("work_output", "storage_key", "TEXT");
ensureColumn("work_output", "sha256", "TEXT");
ensureColumn("work_output", "revision", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("work_output", "finalized", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("work_conversation", "request_id", "TEXT");
database.exec("CREATE TABLE IF NOT EXISTS work_allocation_recovery (request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, conversation_id TEXT NOT NULL)");

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

/** Atomic admission prevents two requests from running one conversation. */
export function claimConversationRun(userId: string, conversationId: string, requestId: string): boolean {
  return database.prepare("UPDATE work_conversation SET status = 'running', sandbox_id = NULL, error = NULL, request_id = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status != 'running'")
    .run(requestId, new Date().toISOString(), conversationId, userId).changes === 1;
}

/** Single-server startup recovery: retain history, never replay side effects. */
export function recoverInterruptedRuns() {
  const rows = database.prepare("SELECT id, user_id, sandbox_id, request_id FROM work_conversation WHERE status = 'running'").all() as unknown as Array<{ id: string; user_id: string; sandbox_id: string | null; request_id: string | null }>;
  for (const row of rows) {
    if (row.sandbox_id) enqueueSandboxCleanup(row.user_id, row.id, row.sandbox_id, "Application restarted during Work");
    else if (row.request_id) database.prepare("INSERT OR IGNORE INTO work_allocation_recovery VALUES (?, ?, ?)").run(row.request_id, row.user_id, row.id);
    updateConversationRun(row.user_id, row.id, { status: "failed", error: "Work was interrupted by an application restart. Saved outputs are retained; submit a new turn to continue." });
  }
}

export function pendingAllocationRecovery() {
  return database.prepare("SELECT request_id, user_id, conversation_id FROM work_allocation_recovery").all() as unknown as Array<{ request_id: string; user_id: string; conversation_id: string }>;
}

export function enqueueAllocationRecovery(userId: string, conversationId: string, requestId: string) {
  database.prepare("INSERT OR IGNORE INTO work_allocation_recovery VALUES (?, ?, ?)").run(requestId, userId, conversationId);
}

export function finishAllocationRecovery(requestId: string) {
  database.prepare("DELETE FROM work_allocation_recovery WHERE request_id = ?").run(requestId);
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
): {
  conversation: Conversation;
  messages: ConversationMessage[];
  outputs: ConversationOutput[];
} | null {
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
  const outputs = database
    .prepare(`
      SELECT id, conversation_id, sandbox_id, path, name, mime_type,
             size_bytes, storage_key, sha256, revision, finalized,
             updated_at, created_at
      FROM work_output
      WHERE conversation_id = ? AND user_id = ? AND finalized = 1
      ORDER BY created_at ASC
    `)
    .all(conversationId, userId) as unknown as OutputRow[];
  return {
    conversation: mapConversation(row),
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.created_at,
    })),
    outputs: outputs.map((output) => publicOutput(mapOutput(output))),
  };
}

export function listStoredConversationOutputs(
  userId: string,
  conversationId: string,
): StoredConversationOutput[] {
  const rows = database
    .prepare(`
      SELECT id, conversation_id, sandbox_id, path, name, mime_type,
             size_bytes, storage_key, sha256, revision, finalized,
             updated_at, created_at
      FROM work_output
      WHERE conversation_id = ? AND user_id = ? AND finalized = 1
      ORDER BY created_at ASC
    `)
    .all(conversationId, userId) as unknown as OutputRow[];
  return rows.map(mapOutput);
}

export function reserveConversationOutput(
  userId: string,
  conversationId: string,
  sandboxId: string,
  output: {
    path: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    updatedAt: string;
  },
): { id: string; revision: number; finalized: boolean } {
  const existing = database
    .prepare(`
      SELECT id, conversation_id, sandbox_id, path, name, mime_type,
             size_bytes, storage_key, sha256, revision, finalized,
             updated_at, created_at
      FROM work_output
      WHERE conversation_id = ? AND user_id = ? AND path = ? AND updated_at = ?
    `)
    .get(conversationId, userId, output.path, output.updatedAt) as
    | OutputRow
    | undefined;
  if (existing) {
    return {
      id: existing.id,
      revision: existing.revision,
      finalized: existing.finalized === 1,
    };
  }
  const row: OutputRow = {
    id: randomUUID(),
    conversation_id: conversationId,
    sandbox_id: sandboxId,
    path: output.path,
    name: output.name,
    mime_type: output.mimeType,
    size_bytes: output.sizeBytes,
    storage_key: null,
    sha256: null,
    revision: 1,
    finalized: 0,
    updated_at: output.updatedAt,
    created_at: new Date().toISOString(),
  };
  const inserted = database
    .prepare(`
      INSERT INTO work_output
        (id, conversation_id, user_id, sandbox_id, path, name, mime_type,
         size_bytes, storage_key, sha256, revision, finalized, updated_at, created_at)
      SELECT ?, id, user_id, ?, ?, ?, ?, ?, NULL, NULL,
             COALESCE((SELECT MAX(revision) + 1 FROM work_output WHERE conversation_id = ? AND name = ?), 1),
             0, ?, ?
      FROM work_conversation
      WHERE id = ? AND user_id = ?
    `)
    .run(
      row.id,
      sandboxId,
      output.path,
      output.name,
      output.mimeType,
      output.sizeBytes,
      conversationId,
      output.name,
      output.updatedAt,
      row.created_at,
      conversationId,
      userId,
    );
  if (inserted.changes !== 1) throw new Error("Conversation not found");
  const reserved = database
    .prepare(`
      SELECT revision, finalized FROM work_output
      WHERE id = ? AND conversation_id = ? AND user_id = ?
    `)
    .get(row.id, conversationId, userId) as
    | { revision: number; finalized: number }
    | undefined;
  if (!reserved) throw new Error("Reserved output not found");
  return {
    id: row.id,
    revision: reserved.revision,
    finalized: reserved.finalized === 1,
  };
}

export function finalizeConversationOutput(
  userId: string,
  conversationId: string,
  outputId: string,
  stored: { storageKey: string; sha256: string; sizeBytes: number },
): ConversationOutput {
  const updated = database
    .prepare(`
      UPDATE work_output
      SET storage_key = ?, sha256 = ?, size_bytes = ?, finalized = 1
      WHERE id = ? AND conversation_id = ? AND user_id = ?
    `)
    .run(
      stored.storageKey,
      stored.sha256,
      stored.sizeBytes,
      outputId,
      conversationId,
      userId,
    );
  if (updated.changes !== 1) throw new Error("Reserved output not found");
  const output = getConversationOutput(userId, conversationId, outputId);
  if (!output) throw new Error("Finalized output not found");
  return publicOutput(output);
}

export function removePendingConversationOutput(
  userId: string,
  conversationId: string,
  outputId: string,
): void {
  database
    .prepare(`
      DELETE FROM work_output
      WHERE id = ? AND conversation_id = ? AND user_id = ? AND finalized = 0
    `)
    .run(outputId, conversationId, userId);
}

export function listPendingConversationOutputsForSandbox(sandboxId: string): Array<{
  id: string;
  userId: string;
  conversationId: string;
  path: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}> {
  return database
    .prepare(`
      SELECT id, user_id AS userId, conversation_id AS conversationId,
             path, name, mime_type AS mimeType, size_bytes AS sizeBytes
      FROM work_output
      WHERE sandbox_id = ? AND finalized = 0
      ORDER BY created_at ASC
    `)
    .all(sandboxId) as Array<{
    id: string;
    userId: string;
    conversationId: string;
    path: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }>;
}

export function getConversationOutput(
  userId: string,
  conversationId: string,
  outputId: string,
): StoredConversationOutput | null {
  const row = database
    .prepare(`
      SELECT id, conversation_id, sandbox_id, path, name, mime_type,
             size_bytes, storage_key, sha256, revision, finalized,
             updated_at, created_at
      FROM work_output
      WHERE id = ? AND conversation_id = ? AND user_id = ? AND finalized = 1
    `)
    .get(outputId, conversationId, userId) as OutputRow | undefined;
  return row ? mapOutput(row) : null;
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

export function enqueueSandboxCleanup(
  userId: string,
  conversationId: string | null,
  sandboxId: string,
  error?: string,
): void {
  const now = new Date().toISOString();
  database
    .prepare(`
      INSERT INTO work_sandbox_cleanup
        (sandbox_id, user_id, conversation_id, status, attempts, last_error,
         next_attempt_at, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
      ON CONFLICT(sandbox_id) DO UPDATE SET
        status = 'pending', last_error = excluded.last_error,
        next_attempt_at = excluded.next_attempt_at, updated_at = excluded.updated_at
    `)
    .run(sandboxId, userId, conversationId, error ?? null, now, now, now);
}

export function listPendingSandboxCleanups(limit = 10): Array<{
  sandboxId: string;
  attempts: number;
}> {
  return database
    .prepare(`
      SELECT sandbox_id AS sandboxId, attempts
      FROM work_sandbox_cleanup
      WHERE status = 'pending' AND next_attempt_at <= ?
      ORDER BY next_attempt_at ASC
      LIMIT ?
    `)
    .all(new Date().toISOString(), limit) as Array<{
    sandboxId: string;
    attempts: number;
  }>;
}

export function completeSandboxCleanup(sandboxId: string): void {
  database
    .prepare(`
      UPDATE work_sandbox_cleanup
      SET status = 'complete', last_error = NULL, updated_at = ?
      WHERE sandbox_id = ?
    `)
    .run(new Date().toISOString(), sandboxId);
}

export function retrySandboxCleanup(
  sandboxId: string,
  attempts: number,
  error: string,
): void {
  const delayMs = Math.min(60 * 60_000, 2 ** Math.min(attempts, 10) * 1_000);
  const now = new Date();
  database
    .prepare(`
      UPDATE work_sandbox_cleanup
      SET attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?
      WHERE sandbox_id = ?
    `)
    .run(
      attempts + 1,
      error,
      new Date(now.getTime() + delayMs).toISOString(),
      now.toISOString(),
      sandboxId,
    );
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

function mapOutput(row: OutputRow): StoredConversationOutput {
  if (!row.storage_key || !row.sha256) {
    throw new Error(`Output ${row.id} is not finalized`);
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sandboxId: row.sandbox_id,
    path: row.path,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storageKey: row.storage_key,
    sha256: row.sha256,
    revision: row.revision,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
    downloadUrl: `/api/conversations/${encodeURIComponent(
      row.conversation_id,
    )}/outputs/${encodeURIComponent(row.id)}`,
  };
}

function publicOutput(output: StoredConversationOutput): ConversationOutput {
  const { storageKey: _storageKey, sha256: _sha256, ...publicFields } = output;
  return publicFields;
}

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (columns.some((candidate) => candidate.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function titleFromMessage(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 56 ? `${compact.slice(0, 55).trimEnd()}…` : compact || "New task";
}
