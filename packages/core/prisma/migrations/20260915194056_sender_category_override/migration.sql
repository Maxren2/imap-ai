-- CreateTable
CREATE TABLE "SenderCategoryOverride" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderCategoryOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SenderCategoryOverride_accountId_senderAddress_key" ON "SenderCategoryOverride"("accountId", "senderAddress");

-- AddForeignKey
ALTER TABLE "SenderCategoryOverride" ADD CONSTRAINT "SenderCategoryOverride_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
