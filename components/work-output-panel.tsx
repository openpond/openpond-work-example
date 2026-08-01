"use client";

import {
  Check,
  CircleAlert,
  Download,
  FileText,
  LoaderCircle,
  PanelRightClose,
  Terminal,
} from "lucide-react";

import type { ActivityRow, WorkActivityGroup } from "@/components/types";
import type { ConversationOutput } from "@/lib/conversations";

export function WorkOutputPanel({
  groups,
  outputs,
  onClose,
}: {
  groups: WorkActivityGroup[];
  outputs: ConversationOutput[];
  onClose: () => void;
}) {
  const groupedOutputIds = new Set(
    groups.flatMap((group) => group.outputs.map((output) => output.id)),
  );
  const savedOutputs = outputs.filter((output) => !groupedOutputIds.has(output.id));
  const empty = groups.length === 0 && savedOutputs.length === 0;
  return (
    <aside className="output-panel" aria-label="Work output">
      <button className="panel-toggle output-close" type="button" onClick={onClose} aria-label="Close work output">
        <PanelRightClose size={17} />
      </button>
      <div className="output-scroll" aria-live="polite">
        {empty ? (
          <div className="output-empty">
            <p>Output will appear here</p>
          </div>
        ) : (
          groups.map((group, index) => (
            <section className={`work-group ${group.state}`} key={group.id}>
              <header className="work-group-header">
                <span className="work-group-index">{index + 1}</span>
                <div>
                  <strong>{group.title}</strong>
                  <small>{groupLabel(group.state)}</small>
                </div>
              </header>
              <div className="work-group-rows">
                {group.rows.map((row) => (
                  <div className={`activity-row ${row.state}`} key={row.id}>
                    <ActivityIcon row={row} />
                    <div>
                      <span>{row.label}</span>
                      {row.detail ? <small title={row.detail}>{row.detail}</small> : null}
                    </div>
                  </div>
                ))}
              </div>
              {group.outputs.length > 0 ? (
                <OutputCards outputs={group.outputs} />
              ) : null}
            </section>
          ))
        )}
        {savedOutputs.length > 0 ? (
          <section className="work-group success">
            <header className="work-group-header">
              <FileText size={16} />
              <div>
                <strong>Saved outputs</strong>
                <small>{savedOutputs.length === 1 ? "1 file" : `${savedOutputs.length} files`}</small>
              </div>
            </header>
            <OutputCards outputs={savedOutputs} />
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function OutputCards({ outputs }: { outputs: ConversationOutput[] }) {
  return (
    <div className="output-cards">
      {outputs.map((output) => (
        <a className="output-card" href={output.downloadUrl} key={output.id}>
          <FileText aria-hidden size={16} />
          <span>
            <strong>{output.name}</strong>
            <small>{formatBytes(output.sizeBytes)}</small>
          </span>
          <Download aria-hidden size={15} />
        </a>
      ))}
    </div>
  );
}

function groupLabel(state: WorkActivityGroup["state"]): string {
  if (state === "active") return "Running";
  if (state === "error") return "Failed";
  return "Completed";
}

function ActivityIcon({ row }: { row: ActivityRow }) {
  if (row.state === "active") return <LoaderCircle className="spin" size={14} />;
  if (row.state === "error") return <CircleAlert size={14} />;
  if (row.id !== "sandbox" && row.id !== "starting" && !row.id.startsWith("status-")) {
    return <Terminal size={14} />;
  }
  return <Check size={14} />;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
