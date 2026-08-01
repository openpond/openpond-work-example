"use client";

import {
  Check,
  CircleAlert,
  LoaderCircle,
  PanelRightClose,
  Terminal,
} from "lucide-react";

import type { ActivityRow, WorkActivityGroup } from "@/components/types";

export function WorkOutputPanel({
  groups,
  onClose,
}: {
  groups: WorkActivityGroup[];
  onClose: () => void;
}) {
  return (
    <aside className="output-panel" aria-label="Work output">
      <button className="panel-toggle output-close" type="button" onClick={onClose} aria-label="Close work output">
        <PanelRightClose size={17} />
      </button>
      <div className="output-scroll" aria-live="polite">
        {groups.length === 0 ? (
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
            </section>
          ))
        )}
      </div>
    </aside>
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
