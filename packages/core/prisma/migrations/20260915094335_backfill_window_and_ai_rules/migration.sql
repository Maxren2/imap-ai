-- AlterTable
ALTER TABLE "Mailbox" ADD COLUMN     "backfillBeforeUid" INTEGER,
ADD COLUMN     "fullyBackfilled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "aiPrompt" TEXT,
ALTER COLUMN "conditions" DROP NOT NULL;
