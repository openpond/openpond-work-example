"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ConversationMessage } from "@/lib/conversations";

export function Transcript({
  messages,
}: {
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
    </div>
  );
}
