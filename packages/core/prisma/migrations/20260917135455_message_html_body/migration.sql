-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "bodyHtml" TEXT,
ADD COLUMN     "bodyHtmlFetchedAt" TIMESTAMP(3);
