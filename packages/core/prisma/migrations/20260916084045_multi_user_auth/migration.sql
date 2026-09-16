-- Hand-written, not `prisma migrate dev` generated output: the default
-- diff wants to DROP TABLE "Account" and CREATE TABLE "EmailAccount",
-- which would cascade-delete every Mailbox/Message/Rule/Chat/etc. row
-- under this environment's one real, already-synced account. This does
-- an in-place rename instead, preserving every row and every existing
-- foreign key.
--
-- "userId" is added nullable here on purpose, with no FK to "User" yet --
-- there is no User row to point the existing EmailAccount at until the
-- migrate-legacy-account script (packages/core/src/migrate-legacy-account.ts)
-- runs. A second migration (after that script has run once against real
-- data) adds the NOT NULL constraint and the FK.

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- RenameTable (preserves data, indexes, and every accountId foreign key)
ALTER TABLE "Account" RENAME TO "EmailAccount";
ALTER TABLE "EmailAccount" RENAME CONSTRAINT "Account_pkey" TO "EmailAccount_pkey";
ALTER INDEX "Account_email_key" RENAME TO "EmailAccount_email_idx";

-- AlterTable: new nullable columns (userId included -- backfilled by the
-- legacy-migration script, made NOT NULL in a follow-up migration once
-- every existing row has one).
ALTER TABLE "EmailAccount"
    ADD COLUMN "userId" TEXT,
    ADD COLUMN "oauthRefreshTokenEnc" TEXT,
    ADD COLUMN "imapHost" TEXT,
    ADD COLUMN "imapPort" INTEGER,
    ADD COLUMN "imapUser" TEXT,
    ADD COLUMN "imapPasswordEnc" TEXT,
    ADD COLUMN "smtpHost" TEXT,
    ADD COLUMN "smtpPort" INTEGER;

-- The old global "one email, period" uniqueness becomes "unique per user"
-- -- drop the plain email index in favor of the compound one. Safe with
-- a NULL userId still present: Postgres treats NULL as distinct in a
-- unique index, so the one pre-existing row doesn't collide with itself.
DROP INDEX "EmailAccount_email_idx";
CREATE UNIQUE INDEX "EmailAccount_userId_email_key" ON "EmailAccount"("userId", "email");
