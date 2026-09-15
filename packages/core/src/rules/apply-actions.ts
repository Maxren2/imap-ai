import "../env.js";
import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/index.js";
import { connectImap, requireEnv } from "../imap-connect.js";
import { parseRuleActions, applyRuleActions } from "./actions.js";

/**
 * Applies each rule's actions (label/archive/markRead/star) to matches
 * that haven't been acted on yet. Separate from rules:run (detection) on
 * purpose -- matching is cheap and safe to run often, acting on the real
 * mailbox is not, so they run as distinct, independently-idempotent steps.
 */
async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");

  const rulesWithActions = await prisma.rule.findMany({
    where: { enabled: true, actions: { not: Prisma.DbNull } },
  });

  const pendingByRule = await Promise.all(
    rulesWithActions.map(async (rule) => {
      const pending = await prisma.ruleMatch.findMany({
        where: { ruleId: rule.id, actionsAppliedAt: null },
        include: { message: { select: { id: true, uid: true, subject: true } } },
      });
      return { rule, pending };
    }),
  );

  const totalPending = pendingByRule.reduce((sum, { pending }) => sum + pending.length, 0);
  if (totalPending === 0) {
    console.log("Nothing to act on.");
    return;
  }

  // All current matches live in INBOX -- single-mailbox MVP scope, same
  // simplification already made for AI body-fetching in rules:run.
  const client = await connectImap(gmailAddress);
  const lock = await client.getMailboxLock("INBOX");

  try {
    for (const { rule, pending } of pendingByRule) {
      if (pending.length === 0) continue;

      let actions;
      try {
        actions = parseRuleActions(rule.actions);
      } catch (error) {
        console.error(`Rule "${rule.name}" has invalid actions, skipping:`, error);
        continue;
      }

      let applied = 0;
      let failed = 0;
      for (const match of pending) {
        try {
          await applyRuleActions(client, match.message.uid, actions);
          await prisma.ruleMatch.update({
            where: { id: match.id },
            data: { actionsAppliedAt: new Date(), actionsError: null },
          });
          applied++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Failed to apply actions for "${match.message.subject}" (rule "${rule.name}"):`, message);
          await prisma.ruleMatch.update({ where: { id: match.id }, data: { actionsError: message } });
          failed++;
        }
      }

      console.log(`Rule "${rule.name}": applied actions to ${applied} match(es)${failed > 0 ? `, ${failed} failed` : ""}.`);
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

main()
  .catch((error) => {
    console.error("rules:apply-actions failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
