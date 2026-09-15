-- CreateTable
CREATE TABLE "RuleAiEvaluation" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleAiEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RuleAiEvaluation_ruleId_messageId_key" ON "RuleAiEvaluation"("ruleId", "messageId");

-- CreateIndex
CREATE INDEX "RuleAiEvaluation_messageId_idx" ON "RuleAiEvaluation"("messageId");

-- AddForeignKey
ALTER TABLE "RuleAiEvaluation" ADD CONSTRAINT "RuleAiEvaluation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleAiEvaluation" ADD CONSTRAINT "RuleAiEvaluation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
