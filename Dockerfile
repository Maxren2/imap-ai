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
# `-H 0.0.0.0` matters: `next start`'s default binding isn't reachable
# from outside the container without it. PORT is the conventional env var
# most container platforms (including TrueNAS's app catalog) set to
# control the exposed port; -p reads it at container start, not bake time.
CMD ["sh", "-c", "npx --prefix apps/web next start -H 0.0.0.0 -p \"${PORT:-3000}\""]
