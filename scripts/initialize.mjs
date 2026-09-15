import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";

const file = process.env.OPENPOND_WORK_DATABASE;
if (!file || !path.isAbsolute(file)) throw new Error("OPENPOND_WORK_DATABASE must be an absolute durable path");
mkdirSync(path.dirname(file), { recursive: true });
const database = new DatabaseSync(file);
database.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 15000;");
const migrations = await getMigrations({ database, emailAndPassword: { enabled: true } });
await migrations.runMigrations();
database.close();
console.info("Authentication database initialized");
