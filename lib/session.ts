import "server-only";

import { headers } from "next/headers";

import { auth } from "@/lib/auth";

export async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireApiSession() {
  const session = await currentSession();
  if (!session) return null;
  return session;
}
