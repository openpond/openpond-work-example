import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Account = {
  apiKey?: string;
  apiBaseUrl?: string;
  baseUrl?: string;
  environment?: string;
};

const appRoot = path.resolve(import.meta.dirname, "..");
const openPondConfig = path.join(process.env.HOME || "", ".openpond", "config.json");
const config = JSON.parse(await readFile(openPondConfig, "utf8")) as { accounts?: Account[] };
const account = config.accounts?.find((candidate) =>
  [candidate.apiBaseUrl, candidate.baseUrl].some((value) => {
    try {
      const hostname = new URL(value || "").hostname;
      return hostname === "staging.openpond.ai" || hostname.endsWith(".staging-api.openpond.ai");
    } catch {
      return false;
    }
  }),
);
const apiKey = account?.apiKey?.trim();
const apiBaseUrl = account?.apiBaseUrl?.trim();
if (!apiKey?.startsWith("opk_") || !apiBaseUrl) {
  throw new Error("No saved staging OpenPond API key was found in ~/.openpond/config.json");
}

const protection = spawnSync(
  process.platform === "win32" ? "vercel.cmd" : "vercel",
  ["project", "protection", "--format", "json"],
  {
    cwd: path.resolve(appRoot, "../sandbox"),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  },
);
const bypassSecret = protection.status === 0
  ? parseBypassSecret(typeof protection.stdout === "string" ? protection.stdout : "")
  : null;
const authSecret = randomBytes(32).toString("base64url");
const contents = [
  `OPENPOND_API_KEY=${apiKey}`,
  `OPENPOND_API_URL=${apiBaseUrl}`,
  ...(bypassSecret ? [`VERCEL_AUTOMATION_BYPASS_SECRET=${bypassSecret}`] : []),
  `BETTER_AUTH_SECRET=${authSecret}`,
  "BETTER_AUTH_URL=http://localhost:3000",
  "",
].join("\n");

await writeFile(path.join(appRoot, ".env.local"), contents, { encoding: "utf8", mode: 0o600 });
console.log(`Wrote .env.local with staging API key: yes; Vercel bypass: ${bypassSecret ? "yes" : "no"}.`);

function parseBypassSecret(value: string): string | null {
  try {
    const payload = JSON.parse(value) as {
      protectionBypass?: Record<string, { isEnvVar?: boolean } | null>;
    };
    const entries = Object.entries(payload.protectionBypass ?? {});
    const selected = entries.find(([, metadata]) => metadata?.isEnvVar) ?? entries[0];
    return selected?.[0]?.trim() || null;
  } catch {
    return null;
  }
}
