import type { OpenPondWorkEvent } from "openpond-sdk";

import type { ActivityRow, WorkActivityGroup } from "@/components/types";

export function createActivityGroup(id: string, prompt: string): WorkActivityGroup {
  return {
    id,
    title: compactTitle(prompt),
    state: "active",
    rows: [{ id: "starting", label: "Preparing sandbox", state: "active" }],
  };
}

export function projectWorkEvent(
  groups: WorkActivityGroup[],
  runId: string,
  event: OpenPondWorkEvent,
): WorkActivityGroup[] {
  return updateGroup(groups, runId, (group) => ({
    ...group,
    rows: projectRows(group.rows, event),
  }));
}

export function completeActivityGroup(
  groups: WorkActivityGroup[],
  runId: string,
): WorkActivityGroup[] {
  return updateGroup(groups, runId, (group) => ({
    ...group,
    state: "success",
    rows: group.rows.map((row) =>
      row.state === "active" ? { ...row, state: "success" as const } : row,
    ),
  }));
}

export function failActivityGroup(
  groups: WorkActivityGroup[],
  runId: string,
  message: string,
): WorkActivityGroup[] {
  return updateGroup(groups, runId, (group) => ({
    ...group,
    state: "error",
    rows: [
      ...group.rows.filter((row) => row.state !== "active"),
      { id: `error-${runId}`, label: message, state: "error" },
    ],
  }));
}

function projectRows(rows: ActivityRow[], event: OpenPondWorkEvent): ActivityRow[] {
  if (event.type === "status") {
    return [
      ...rows.map((row) =>
        row.state === "active" ? { ...row, state: "success" as const } : row,
      ),
      { id: `status-${rows.length}`, label: event.message, state: "active" },
    ];
  }
  if (event.type === "sandbox") {
    return [
      ...rows.filter((row) => row.id !== "sandbox"),
      {
        id: "sandbox",
        label: `Sandbox ${event.state}`,
        detail: event.sandboxId,
        state: "success",
      },
    ];
  }
  if (event.type === "tool") {
    const row: ActivityRow = {
      id: event.toolCallId,
      label: event.status === "started" ? "Running command" : event.command,
      detail: event.status === "started" ? event.command : summarizeOutput(event.output),
      state:
        event.status === "started"
          ? "active"
          : event.status === "succeeded"
            ? "success"
            : "error",
    };
    return [...rows.filter((item) => item.id !== row.id), row];
  }
  return rows;
}

function updateGroup(
  groups: WorkActivityGroup[],
  runId: string,
  update: (group: WorkActivityGroup) => WorkActivityGroup,
): WorkActivityGroup[] {
  return groups.map((group) => (group.id === runId ? update(group) : group));
}

function compactTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 71).trimEnd()}…` : compact;
}

function summarizeOutput(output?: string): string | undefined {
  const compact = output?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 240 ? `${compact.slice(0, 239)}…` : compact;
}
