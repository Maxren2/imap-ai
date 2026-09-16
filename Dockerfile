# Single production image for the whole app -- NOT a pruned Next.js
# "standalone" build. That would strip node_modules/tsx/source down to
# just what `next start` needs, but this app's background jobs (sync,
# watch, rules:run, rules:apply-actions, backfill, deep-clean) are real
# `npm run <script>` invocations spawned at runtime by the web server
# itself (apps/web/lib/background-run.ts) -- they need the full monorepo
# (source + devDependencies, since scripts run via `tsx`) present in the
# same container the web server runs in, not just its own build output.
# See DESIGN.md's Docker section for the full reasoning and the size
# tradeoff that comes with it.
FROM node:20-bookworm-slim

# Prisma's native query/schema-engine binaries link against libssl at
# runtime -- bookworm-slim doesn't include it by default. Without this,
# `prisma migrate deploy` fails with an opaque, message-less "Schema
# engine error:" (confirmed live: the container started, connected to
# Postgres fine, then died on exactly this with no further detail) --
# Prisma's own startup warning names the real cause and the fix
# explicitly, so this isn't a guess.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the whole repo before `npm ci` (rather than package.json files
# first for better layer caching) because the root `postinstall` script
# runs `prisma generate`, which needs prisma/schema.prisma already present
# -- simplest correct option for a first version; revisit if build times
# become a real problem.
COPY . .

RUN npm ci && \
    npm run build -w @imap-ai/web

ENV NODE_ENV=production
EXPOSE 3000

RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
# `cd apps/web` matters, not just `--prefix` -- `next start` looks for its
# `.next` build output relative to its own process cwd, not wherever
# `--prefix`/`npm run -w` resolves the package from; running it from the
# repo root (this image's WORKDIR) looked for a nonexistent `/app/.next`
# and failed, even though the real build output was sitting right there
# at `/app/apps/web/.next` -- confirmed live, not assumed. `-H 0.0.0.0`
# matters too: `next start`'s default binding isn't reachable from outside
# the container without it. PORT is the conventional env var most
# container platforms (including TrueNAS's app catalog) set to control the
# exposed port; -p reads it at container start, not bake time.
CMD ["sh", "-c", "cd apps/web && npx next start -H 0.0.0.0 -p \"${PORT:-3000}\""]
