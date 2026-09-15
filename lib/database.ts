import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const globalDatabase = globalThis as typeof globalThis & {
  openPondWorkDatabase?: DatabaseSync;
};

function createDatabase(): DatabaseSync {
  const file = process.env.OPENPOND_WORK_DATABASE?.trim()
    ? path.resolve(process.env.OPENPOND_WORK_DATABASE)
    : path.join(process.cwd(), ".data", "openpond-work.sqlite");
  mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  // Next.js evaluates route modules concurrently during production builds.
  // Give a sibling worker time to finish SQLite's one-time WAL negotiation
  // instead of failing page-data collection with SQLITE_BUSY/LOCKED.
  database.exec("PRAGMA busy_timeout = 15000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec("PRAGMA foreign_keys = ON");
  return database;
}

export const database = globalDatabase.openPondWorkDatabase ?? createDatabase();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.openPondWorkDatabase = database;
}
