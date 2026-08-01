import assert from "node:assert/strict";
import test from "node:test";

import {
  completeActivityGroup,
  createActivityGroup,
  failActivityGroup,
  projectWorkEvent,
} from "./work-activity";

test("groups one work run and updates command rows in place", () => {
  const runId = "run-1";
  let groups = [createActivityGroup(runId, "Create a file and read it back")];

  groups = projectWorkEvent(groups, runId, {
    type: "status",
    message: "Thinking · step 1",
  });
  groups = projectWorkEvent(groups, runId, {
    type: "sandbox",
    sandboxId: "sandbox-1",
    state: "running",
  });
  groups = projectWorkEvent(groups, runId, {
    type: "tool",
    toolCallId: "tool-1",
    command: "printf hello > hello.txt",
    status: "started",
  });
  groups = projectWorkEvent(groups, runId, {
    type: "tool",
    toolCallId: "tool-1",
    command: "printf hello > hello.txt",
    status: "succeeded",
    output: "hello",
    exitCode: 0,
  });
  groups = completeActivityGroup(groups, runId);

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.state, "success");
  assert.equal(groups[0]?.rows.filter((row) => row.id === "tool-1").length, 1);
  assert.deepEqual(
    groups[0]?.rows.find((row) => row.id === "tool-1"),
    {
      id: "tool-1",
      label: "printf hello > hello.txt",
      detail: "hello",
      state: "success",
    },
  );
});

test("keeps failures inside the matching work group", () => {
  const groups = failActivityGroup(
    [
      createActivityGroup("run-1", "First run"),
      createActivityGroup("run-2", "Second run"),
    ],
    "run-2",
    "Sandbox unavailable",
  );

  assert.equal(groups[0]?.state, "active");
  assert.equal(groups[1]?.state, "error");
  assert.equal(groups[1]?.rows.at(-1)?.label, "Sandbox unavailable");
});

test("keeps detected outputs inside the matching work group", () => {
  const output = {
    id: "output-1",
    conversationId: "conversation-1",
    sandboxId: "sandbox-1",
    path: "/workspace/outputs/report.docx",
    name: "report.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 4812,
    revision: 1,
    updatedAt: "2026-07-31T20:00:00.000Z",
    createdAt: "2026-07-31T20:00:01.000Z",
    downloadUrl: "/api/conversations/conversation-1/outputs/output-1",
  };
  const groups = projectWorkEvent(
    [createActivityGroup("run-1", "Create a report")],
    "run-1",
    { type: "output", output },
  );

  assert.deepEqual(groups[0]?.outputs, [output]);
});
