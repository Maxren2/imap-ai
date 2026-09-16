-- Adds an authorization tier: "admin" or "user" (plain string, see
-- schema.prisma's comment on User.role). Every existing User predates
-- this column, so the second statement promotes whichever one signed up
-- first (there is exactly one in this environment's real data) to admin,
-- matching the "first person to ever sign up becomes admin" rule new
-- signups follow going forward (apps/web/app/signup/actions.ts).
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

UPDATE "User"
SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC LIMIT 1);
