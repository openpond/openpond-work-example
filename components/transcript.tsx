"use client";

import { Check, CircleAlert, LoaderCircle, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ConversationMessage } from "@/lib/conversations";
import type { ActivityRow } from "@/components/types";

export function Transcript({
  activity,
  messages,
}: {
  activity: ActivityRow[];
  messages: ConversationMessage[];
}) {
  return (
    <div className="transcript">
      {messages.map((message) => (
        <article className={`message ${message.role}`} key={message.id}>
          <div className="message-label">{message.role === "user" ? "You" : "OpenPond"}</div>
          {message.role === "assistant" ? (
            <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>
          ) : (
            <p>{message.content}</p>
          )}
        </article>
      ))}
      {activity.length > 0 ? (
        <section className="activity" aria-live="polite">
          {activity.map((row) => (
            <div className={`activity-row ${row.state}`} key={row.id}>
              <ActivityIcon row={row} />
              <div><span>{row.label}</span>{row.detail ? <small>{row.detail}</small> : null}</div>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ActivityIcon({ row }: { row: ActivityRow }) {
  if (row.state === "active") return <LoaderCircle className="spin" size={15} />;
  if (row.state === "error") return <CircleAlert size={15} />;
  if (row.label.startsWith("Ran")) return <Terminal size={15} />;
  return <Check size={15} />;
}
