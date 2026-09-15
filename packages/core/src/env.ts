import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Loads the repo-root .env regardless of the invoking process's cwd, so
// this works the same whether a script is run via `npm run` from
// packages/core or imported from apps/web.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });
