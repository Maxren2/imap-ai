#!/bin/sh
set -e

# Applies any migrations the image's built-in prisma/migrations/ has that
# the database doesn't yet -- `migrate deploy`, not `migrate dev` (no
# interactive prompts, no dev-only shadow-database diffing, the correct
# command for an already-running production database). Safe to run on
# every container start: a no-op when nothing is pending. Runs before
# every command (not just the default "serve the web app" one) so a
# one-off `docker run <image> npm run backfill` also starts from a
# migrated schema.
npx prisma migrate deploy --schema packages/core/prisma/schema.prisma

exec "$@"
