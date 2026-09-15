import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

test("snapshot restores a consistent database and files and rejects tampering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "work-snapshot-"));
  try {
    const source = path.join(root, "source");
    await mkdir(source);
    const db = new DatabaseSync(path.join(source, "work.sqlite"));
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE work_conversation(status TEXT); CREATE TABLE work_sandbox_cleanup(status TEXT); CREATE TABLE work_allocation_recovery(id TEXT); INSERT INTO work_conversation VALUES ('completed')");
    await writeFile(path.join(source, "saved.txt"), "retained output");
    const run = (...args) => execFileSync(process.execPath, ["scripts/data-snapshot.mjs", ...args], { stdio: "pipe" });
    const snapshot = path.join(root, "snapshot");
    run("backup", source, snapshot);
    db.close();
    run("restore", snapshot, path.join(root, "restored"));
    assert.equal(await readFile(path.join(root, "restored/saved.txt"), "utf8"), "retained output");
    const restored = new DatabaseSync(path.join(root, "restored/work.sqlite"));
    assert.equal(restored.prepare("SELECT status FROM work_conversation").get().status, "completed");
    restored.close();
    assert.throws(() => run("restore", snapshot, path.join(root, "restored")));
    await writeFile(path.join(snapshot, "saved.txt"), "corrupted");
    assert.throws(() => run("restore", snapshot, path.join(root, "corrupted")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
