-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "listUnsubscribeMailto" TEXT,
ADD COLUMN     "listUnsubscribeOneClick" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "listUnsubscribeUrl" TEXT,
ADD COLUMN     "unsubscribeHeadersFetchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SenderStatus" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unhandled',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderStatus_accountId_senderAddress_key" ON "SenderStatus"("accountId", "senderAddress");

-- CreateIndex
CREATE INDEX "Message_fromAddress_idx" ON "Message"("fromAddress");

-- AddForeignKey
ALTER TABLE "SenderStatus" ADD CONSTRAINT "SenderStatus_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
