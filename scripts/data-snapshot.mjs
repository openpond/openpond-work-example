// Run as the application data owner after stopping the single application process.
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [operation, sourceArgument, targetArgument] = process.argv.slice(2);
if (!["backup", "restore"].includes(operation) || !sourceArgument || !targetArgument)
  throw new Error("Usage: node scripts/data-snapshot.mjs <backup|restore> <source-directory> <new-target-directory>; stop the app first");
const source = path.resolve(sourceArgument);
const target = path.resolve(targetArgument);
if (target === source || target.startsWith(source + path.sep) || source.startsWith(target + path.sep))
  throw new Error("Source and destination must be separate directories");
async function inventory(directory, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Data snapshots cannot contain symbolic links");
    if (entry.isDirectory()) files.push(...await inventory(directory, name));
    else if (entry.isFile() && name !== "snapshot.json" && !name.endsWith("-shm")) {
      const bytes = await readFile(path.join(directory, name));
      files.push({ path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    } else if (!entry.isFile()) throw new Error("Unsupported snapshot entry");
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

let database;
try {
  if (operation === "backup") {
    await stat(path.join(source, "work.sqlite"));
    database = new DatabaseSync(path.join(source, "work.sqlite"));
    database.exec("PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE");
    const running = database.prepare("SELECT count(*) AS count FROM work_conversation WHERE status = 'running'").get().count;
    const pending = database.prepare("SELECT count(*) AS count FROM work_sandbox_cleanup WHERE status = 'pending'").get().count;
    const allocations = database.prepare("SELECT count(*) AS count FROM work_allocation_recovery").get().count;
    if (running || pending || allocations) throw new Error("Drain Work and cleanup before backing up");
  } else {
    const manifest = JSON.parse(await readFile(path.join(source, "snapshot.json"), "utf8"));
    if (manifest.schemaVersion !== 1 || JSON.stringify(await inventory(source)) !== JSON.stringify(manifest.files))
      throw new Error("Snapshot integrity verification failed");
  }
  // mkdir intentionally fails for an existing target: restore never overwrites data.
  await mkdir(target, { mode: 0o700 });
  for (const file of await inventory(source)) {
    const destination = path.join(target, file.path);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await cp(path.join(source, file.path), destination, { errorOnExist: true, force: false });
  }
  if (operation === "backup") {
    await writeFile(path.join(target, "snapshot.json"), JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), files: await inventory(target) }, null, 2), { mode: 0o600, flag: "wx" });
  } else {
    const restored = new DatabaseSync(path.join(target, "work.sqlite"));
    try {
      if (restored.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Restored database failed integrity check");
    } finally { restored.close(); }
  }
  console.info(`${operation} completed; keep the app stopped until the selected volume is mounted`);
} finally {
  if (database) { database.exec("ROLLBACK"); database.close(); }
}
