-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "actions" JSONB;

-- AlterTable
ALTER TABLE "RuleMatch" ADD COLUMN     "actionsAppliedAt" TIMESTAMP(3),
ADD COLUMN     "actionsError" TEXT;
