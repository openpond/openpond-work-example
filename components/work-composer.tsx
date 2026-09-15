"use client";

import { ArrowUp, LoaderCircle } from "lucide-react";
import { useRef, type FormEvent, type KeyboardEvent } from "react";

export function WorkComposer({
  centered = false,
  disabled,
  prompt,
  onPromptChange,
  onSubmit,
  onCancel,
}: {
  centered?: boolean;
  disabled: boolean;
  prompt: string;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!disabled && prompt.trim()) onSubmit();
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }
  return (
    <div className={centered ? "composer-stage" : "composer-dock"}>
      {centered ? (
        <div className="welcome-copy">
          <h1>What are we working on?</h1>
          <p>OpenPond will create a sandbox, inspect the workspace, and do the work.</p>
        </div>
      ) : null}
      <form className="composer" ref={formRef} onSubmit={submit}>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={keyDown}
          placeholder="Ask OpenPond to build, investigate, or fix something…"
          rows={centered ? 4 : 3}
          disabled={disabled}
          autoFocus
        />
        <div className="composer-footer">
          {onCancel ? <button type="button" className="panel-toggle" onClick={onCancel}>Cancel work</button> : null}
          <button
            className="send-button"
            type="submit"
            aria-label="Start work"
            disabled={disabled || !prompt.trim()}
          >
            {disabled ? <LoaderCircle className="spin" size={18} /> : <ArrowUp size={18} />}
          </button>
        </div>
      </form>
    </div>
  );
}
