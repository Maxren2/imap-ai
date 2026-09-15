import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reuse the single repo-root .env instead of duplicating secrets into a
// second apps/web/.env.local.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") });

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@imap-ai/core"],
};

export default nextConfig;
