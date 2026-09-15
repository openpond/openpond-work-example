import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

test("ownership and interrupted allocations survive application restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpond-recovery-"));
  process.env.OPENPOND_WORK_DATABASE = path.join(directory, "app.sqlite");
  process.env.OPENPOND_WORK_OUTPUT_DIRECTORY = path.join(directory, "outputs");
  const c = await import("./conversations");
  const { database } = await import("./database");
  const { workOutputStore } = await import("./work-output-store");
  try {
    const conversation = c.createConversation("customer-a");
    assert.equal(c.getConversation("customer-b", conversation.id), null);
    assert.equal(c.claimConversationRun("customer-b", conversation.id, "foreign"), false);
    assert.equal(c.claimConversationRun("customer-a", conversation.id, "request-a"), true);
    assert.equal(c.claimConversationRun("customer-a", conversation.id, "request-b"), false);
    c.appendMessage("customer-a", conversation.id, "user", "Synthetic retained history");
    const stored = await workOutputStore().put({ ownerId: "customer-a", conversationId: conversation.id, outputId: "output-a", name: "proof.txt", mimeType: "text/plain", expectedSizeBytes: 5, bytes: Buffer.from("proof") });
    c.recoverInterruptedRuns();
    assert.equal(c.getConversation("customer-a", conversation.id)?.conversation.status, "failed");
    assert.equal(c.getConversation("customer-a", conversation.id)?.messages.length, 1);
    assert.equal(c.pendingAllocationRecovery()[0]?.request_id, "request-a");
    assert.equal(Buffer.from(await workOutputStore().get(stored.storageKey)).toString(), "proof");
    c.enqueueAllocationRecovery("customer-a", conversation.id, "request-a");
    assert.equal(c.pendingAllocationRecovery().length, 1);
    c.finishAllocationRecovery("request-a");
    assert.equal(c.pendingAllocationRecovery().length, 0);
    await assert.rejects(workOutputStore().get("../app.sqlite"));
    await assert.rejects(workOutputStore().put({ ownerId: "a", conversationId: "b", outputId: "c", name: "bad", mimeType: "text/plain", expectedSizeBytes: 100, bytes: Buffer.from("short") }));
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
