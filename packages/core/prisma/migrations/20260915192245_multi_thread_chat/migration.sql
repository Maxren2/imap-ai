-- DropIndex
DROP INDEX "Chat_accountId_key";

-- AlterTable
ALTER TABLE "Chat" ADD COLUMN     "name" TEXT;

-- CreateIndex
CREATE INDEX "Chat_accountId_idx" ON "Chat"("accountId");
