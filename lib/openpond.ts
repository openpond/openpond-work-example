import "server-only";

import { createOpenPondClient } from "openpond-sdk";

let cached: ReturnType<typeof createOpenPondClient> | null = null;

export function openPondClient() {
  if (cached) return cached;
  const apiKey = process.env.OPENPOND_API_KEY?.trim();
  const sandboxEndpoint = process.env.OPENPOND_SANDBOX_ENDPOINT?.trim();
  const modelEndpoint = process.env.OPENPOND_MODEL_ENDPOINT?.trim();
  cached = createOpenPondClient({
    apiKey,
    baseUrl: process.env.OPENPOND_API_URL?.trim(),
    ...(sandboxEndpoint ? { sandbox: {
      endpoint: sandboxEndpoint,
      apiKey: process.env.OPENPOND_SANDBOX_API_KEY?.trim() ?? "",
    } } : {}),
    ...(modelEndpoint ? { model: {
      endpoint: modelEndpoint,
      apiKey: process.env.OPENPOND_MODEL_API_KEY?.trim() ?? "",
      model: process.env.OPENPOND_MODEL_ID?.trim() ?? "",
    } } : {}),
  });
  return cached;
}
