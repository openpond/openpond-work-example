import { betterAuth } from "better-auth";

import { database } from "@/lib/database";

const production = process.env.NODE_ENV === "production";
const secret = process.env.BETTER_AUTH_SECRET?.trim();
if (production && !secret) {
  throw new Error("BETTER_AUTH_SECRET is required in production");
}

export const auth = betterAuth({
  appName: "OpenPond Work",
  baseURL: process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000",
  secret: secret || "openpond-work-local-development-secret-change-me",
  database,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
});
