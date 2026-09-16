import "../env.js";
import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/index.js";
import { connectAccountImap } from "../mail-provider.js";
import { resolveAccounts } from "../account-scope.js";
import { parseRuleActions, applyRuleActions } from "./actions.js";
import type { EmailAccount } from "../generated/prisma/index.js";

/**
 * Applies each rule's actions (label/archive/markRead/star) to matches
 * that haven't been acted on yet. Separate from rules:run (detection) on
 * purpose -- matching is cheap and safe to run often, acting on the real
 * mailbox is not, so they run as distinct, independently-idempotent steps.
 * Loops over every linked account, one IMAP connection per account --
 * never shared, since a connection only ever sees one mailbox.
 */
async function applyActionsForAccount(account: EmailAccount): Promise<void> {
  const rulesWithActions = await prisma.rule.findMany({
    where: { enabled: true, actions: { not: Prisma.DbNull }, accountId: account.id },
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
    console.log(`[${account.email}] Nothing to act on.`);
    return;
  }

  // All current matches live in INBOX -- single-mailbox MVP scope, same
  // simplification already made for AI body-fetching in rules:run.
  const client = await connectAccountImap(account);
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

      // Both archive and delete take the message out of the inbox --
      // whichever one applyRuleActions actually performs (delete wins if
      // both are somehow set, see its own comment), inInbox needs to flip.
      const removesFromInbox = actions.some((action) => action.type === "archive" || action.type === "delete");

      let applied = 0;
      let failed = 0;
      for (const match of pending) {
        try {
          await applyRuleActions(client, match.message.uid, actions);
          await prisma.ruleMatch.update({
            where: { id: match.id },
            data: { actionsAppliedAt: new Date(), actionsError: null },
          });
          // Gmail omits "\Inbox" from X-GM-LABELS when fetched from within
          // INBOX itself, so `labels` can't tell us this -- track it
          // explicitly instead (see DESIGN.md section 11).
          if (removesFromInbox) {
            await prisma.message.update({ where: { id: match.message.id }, data: { inInbox: false } });
          }
          applied++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Failed to apply actions for "${match.message.subject}" (rule "${rule.name}"):`, message);
          await prisma.ruleMatch.update({ where: { id: match.id }, data: { actionsError: message } });
          failed++;
        }
      }

      console.log(`  [${account.email}] Rule "${rule.name}": applied actions to ${applied} match(es)${failed > 0 ? `, ${failed} failed` : ""}.`);
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

async function main() {
  const accounts = await resolveAccounts();
  if (accounts.length === 0) {
    console.log("No linked accounts.");
    return;
  }

  let anyFailed = false;
  for (const account of accounts) {
    try {
      await applyActionsForAccount(account);
    } catch (error) {
      anyFailed = true;
      console.error(`rules:apply-actions failed for ${account.email}:`, error);
    }
  }
  if (anyFailed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("rules:apply-actions failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
