"use client";

import { LoaderCircle, PanelLeftClose, Plus, Trash2 } from "lucide-react";

import { OpenPondLogo } from "@/components/openpond-logo";
import type { Conversation } from "@/lib/conversations";

export function ConversationSidebar({
  conversations,
  creating,
  busy = false,
  selectedId,
  user,
  onCreate,
  onClose,
  onDelete,
  onSelect,
  onSignOut,
}: {
  conversations: Conversation[];
  creating: boolean;
  busy?: boolean;
  selectedId: string | null;
  user: { name: string; email: string };
  onCreate: () => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  onSignOut: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-row">
          <div className="brand-copy">
            <OpenPondLogo size="small" />
            <span>OpenPond</span>
          </div>
          <button className="panel-toggle" type="button" onClick={onClose} aria-label="Close conversations">
            <PanelLeftClose size={17} />
          </button>
        </div>
        <button className="new-task-button" onClick={onCreate} disabled={creating || busy}>
          {creating ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
          New task
        </button>
      </div>
      <div className="task-heading">Tasks</div>
      <nav className="task-list" aria-label="Conversations">
        {conversations.length === 0 ? (
          <p className="empty-list">No tasks yet</p>
        ) : (
          conversations.map((conversation) => (
            <div
              className={`task-row${selectedId === conversation.id ? " selected" : ""}`}
              key={conversation.id}
            >
              <button className="task-select" disabled={busy} onClick={() => onSelect(conversation.id)}>
                <span className="task-title">{conversation.title}</span>
                <span className="task-meta">
                  <StatusDot status={conversation.status} />
                  {relativeTime(conversation.updatedAt)}
                </span>
              </button>
              <button
                className="icon-button delete-task"
                aria-label={`Delete ${conversation.title}`}
                onClick={() => onDelete(conversation.id)}
                disabled={busy || conversation.status === "running"}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </nav>
      <div className="account-row">
        <div className="account-copy">
          <span>{user.name || user.email}</span>
          <small>{user.email}</small>
        </div>
        <button className="text-button compact" onClick={onSignOut}>Sign out</button>
      </div>
    </aside>
  );
}

function StatusDot({ status }: { status: Conversation["status"] }) {
  return <span className={`status-dot ${status}`} aria-label={status} />;
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}
