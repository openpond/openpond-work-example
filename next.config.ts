import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const directory = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["openpond-sdk", "better-auth"],
  turbopack: {
    root: directory,
  },
};

export default nextConfig;
