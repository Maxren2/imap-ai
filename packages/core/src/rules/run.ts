import "../env.js";
import { prisma } from "../db.js";
import { parseRuleConditions } from "./types.js";
import { evaluateConditions } from "./evaluate.js";

async function main() {
  const rules = await prisma.rule.findMany({ where: { enabled: true } });

  if (rules.length === 0) {
    console.log("No enabled rules.");
    return;
  }

  for (const rule of rules) {
    let conditions;
    try {
      conditions = parseRuleConditions(rule.conditions);
    } catch (error) {
      console.error(`Rule "${rule.name}" (${rule.id}) has invalid conditions, skipping:`, error);
      continue;
    }

    // Only messages this rule hasn't already matched -- re-running is cheap
    // and safe, it just picks up newly-synced mail.
    const candidates = await prisma.message.findMany({
      where: { mailbox: { accountId: rule.accountId }, ruleMatches: { none: { ruleId: rule.id } } },
      select: { id: true, subject: true, fromAddress: true, fromName: true, labels: true },
    });

    const matchedIds = candidates.filter((message) => evaluateConditions(conditions, message)).map((m) => m.id);

    if (matchedIds.length > 0) {
      await prisma.ruleMatch.createMany({
        data: matchedIds.map((messageId) => ({ ruleId: rule.id, messageId })),
        skipDuplicates: true,
      });
    }

    console.log(`Rule "${rule.name}": ${matchedIds.length} new match(es) out of ${candidates.length} candidate(s).`);
  }
}

main()
  .catch((error) => {
    console.error("rules:run failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
