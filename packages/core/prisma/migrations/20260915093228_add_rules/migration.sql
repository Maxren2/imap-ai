-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleMatch" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rule_accountId_name_key" ON "Rule"("accountId", "name");

-- CreateIndex
CREATE INDEX "RuleMatch_messageId_idx" ON "RuleMatch"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleMatch_ruleId_messageId_key" ON "RuleMatch"("ruleId", "messageId");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleMatch" ADD CONSTRAINT "RuleMatch_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleMatch" ADD CONSTRAINT "RuleMatch_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
