-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "systemType" TEXT;

-- CreateTable
CREATE TABLE "ColdEmailException" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColdEmailException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ColdEmailException_accountId_senderAddress_key" ON "ColdEmailException"("accountId", "senderAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Rule_accountId_systemType_key" ON "Rule"("accountId", "systemType");

-- AddForeignKey
ALTER TABLE "ColdEmailException" ADD CONSTRAINT "ColdEmailException_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
