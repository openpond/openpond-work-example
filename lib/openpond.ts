import "server-only";

import { createOpenPondClient } from "@openpond/sdk";

let cached: ReturnType<typeof createOpenPondClient> | null = null;

export function openPondClient() {
  if (cached) return cached;
  const apiKey = process.env.OPENPOND_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENPOND_API_KEY is required on the server");
  cached = createOpenPondClient({
    apiKey,
    baseUrl: process.env.OPENPOND_API_URL?.trim(),
  });
  return cached;
}
