-- Second half of the multi_user_auth migration -- run only after
-- migrate-legacy-account.ts has backfilled userId on every pre-existing
-- EmailAccount row (see that migration's own comment). Fails loudly if a
-- NULL slipped through, rather than silently truncating data.
ALTER TABLE "EmailAccount" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
