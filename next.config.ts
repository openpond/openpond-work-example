import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const directory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  serverExternalPackages: ["openpond-sdk", "better-auth"],
  turbopack: {
    // The development checkout links ../openpond/packages/sdk. Once the SDK
    // dependency comes from npm, keeping the broader root remains harmless.
    root: path.resolve(directory, ".."),
  },
};

export default nextConfig;
