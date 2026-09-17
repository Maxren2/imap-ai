import "../env.js";
import { prisma } from "../db.js";
import { Prisma } from "../generated/prisma/index.js";
import { connectAccountImap, createAccountSmtpTransport } from "../mail-provider.js";
import { resolveAccounts } from "../account-scope.js";
import { parseRuleActions, applyRuleActions, isSendingAction, type RuleActions } from "./actions.js";
import { applySendingActions } from "./sending-actions.js";
import { resolveLlmConfigForUser } from "../ai/llm-config.js";
import { buildAvailabilityContext } from "../calendar/availability.js";
import { ensureMessageBody } from "../body.js";
import type { EmailAccount } from "../generated/prisma/index.js";
import type { Transporter } from "nodemailer";

// Caps how many draft/autoReply/autoForward actions one rule can execute
// per rules:apply-actions run -- these are the ONLY action types that
// send/save real content with no further review (autoForward/autoReply
// send immediately; draft doesn't send, but still costs an AI call and
// writes a real Drafts entry). A rule that suddenly matches a huge
// backlog (e.g. right after enabling it, or a big backfill) should not be
// able to fire hundreds of real sends in one pass -- the rest of its
// pending matches are simply picked up on the next run, same idea as
// RULES_AI_MAX_PER_RUN in rules/run.ts.
const AUTO_SEND_MAX_PER_RUN = Number(process.env.RULES_AUTO_SEND_MAX_PER_RUN) || 20;

/**
 * Applies each rule's actions (label/archive/markRead/star/delete/draft/
 * autoReply/autoForward) to matches that haven't been acted on yet.
 * Separate from rules:run (detection) on purpose -- matching is cheap and
 * safe to run often, acting on the real mailbox is not, so they run as
 * distinct, independently-idempotent steps. Loops over every linked
 * account, one IMAP connection per account -- never shared, since a
 * connection only ever sees one mailbox.
 */
async function applyActionsForAccount(account: EmailAccount): Promise<void> {
  const rulesWithActions = await prisma.rule.findMany({
    where: { enabled: true, actions: { not: Prisma.DbNull }, accountId: account.id },
  });

  const pendingByRule = await Promise.all(
    rulesWithActions.map(async (rule) => {
      const pending = await prisma.ruleMatch.findMany({
        where: { ruleId: rule.id, actionsAppliedAt: null },
        include: {
          message: {
            select: {
              id: true,
              uid: true,
              subject: true,
              fromAddress: true,
              fromName: true,
              toAddress: true,
              date: true,
              messageIdHeader: true,
              bodyText: true,
              bodyFetchedAt: true,
              labels: true,
            },
          },
        },
      });
      return { rule, pending };
    }),
  );

  const totalPending = pendingByRule.reduce((sum, { pending }) => sum + pending.length, 0);
  if (totalPending === 0) {
    console.log(`[${account.email}] Nothing to act on.`);
    return;
  }

  // Only a rule with a draft/autoReply/autoForward action needs an SMTP
  // transport at all -- most accounts have none of those, so this skips
  // opening one unnecessarily. Parse failures are tolerated here (just
  // treated as "no sending action"); the per-rule loop below reports them
  // properly and skips that rule.
  const anySendingAction = pendingByRule.some(({ rule, pending }) => {
    if (pending.length === 0) return false;
    try {
      return parseRuleActions(rule.actions).some(isSendingAction);
    } catch {
      return false;
    }
  });

  // All current matches live in INBOX -- single-mailbox MVP scope, same
  // simplification already made for AI body-fetching in rules:run.
  const client = await connectAccountImap(account);
  const lock = await client.getMailboxLock("INBOX");
  const smtpTransport: Transporter | undefined = anySendingAction ? await createAccountSmtpTransport(account) : undefined;
  const ollamaConfig = anySendingAction ? await resolveLlmConfigForUser(account.userId) : undefined;
  // Computed once per account per run (not per match) -- calendar events
  // don't change fast enough within one run to need refetching per
  // message, and this avoids hammering the Google/Microsoft Calendar API
  // once per draft/autoReply match.
  const availabilityContext = anySendingAction ? await buildAvailabilityContext(account.userId).catch(() => undefined) : undefined;

  try {
    for (const { rule, pending } of pendingByRule) {
      if (pending.length === 0) continue;

      let actions: RuleActions;
      try {
        actions = parseRuleActions(rule.actions);
      } catch (error) {
        console.error(`Rule "${rule.name}" has invalid actions, skipping:`, error);
        continue;
      }

      const sendingActions = actions.filter(isSendingAction);
      const simpleActions = actions.filter((action) => !isSendingAction(action));
      const hasSending = sendingActions.length > 0;

      // Both archive and delete take the message out of the inbox --
      // whichever one applyRuleActions actually performs (delete wins if
      // both are somehow set, see its own comment), inInbox needs to flip.
      const removesFromInbox = actions.some((action) => action.type === "archive" || action.type === "delete");

      // A rule with a sending action only processes up to
      // AUTO_SEND_MAX_PER_RUN matches THIS run -- each one gets its full
      // action list (simple + sending) applied atomically, or not touched
      // at all, never partially (so a capped-out match doesn't end up with
      // e.g. its label applied but actionsAppliedAt still null, which
      // would make the next run try to re-label it -- harmless -- but also
      // re-archive an already-moved UID -- not harmless). A rule with no
      // sending action is uncapped, unchanged from before this feature.
      const toProcess = hasSending ? pending.slice(0, AUTO_SEND_MAX_PER_RUN) : pending;
      const deferred = pending.length - toProcess.length;

      let applied = 0;
      let failed = 0;
      for (const match of toProcess) {
        try {
          if (simpleActions.length > 0) {
            await applyRuleActions(client, match.message.uid, simpleActions);
          }
          if (hasSending) {
            if (!smtpTransport) throw new Error("SMTP transport unavailable for a sending action -- this is a bug.");
            const bodyText =
              match.message.bodyFetchedAt !== null ? match.message.bodyText : await ensureMessageBody(client, match.message);
            await applySendingActions(
              { imapClient: client, smtpTransport, fromEmail: account.email, ollamaConfig, availabilityContext },
              {
                subject: match.message.subject,
                fromAddress: match.message.fromAddress,
                fromName: match.message.fromName,
                toAddress: match.message.toAddress,
                date: match.message.date,
                messageIdHeader: match.message.messageIdHeader,
                bodyText,
                labels: match.message.labels,
              },
              sendingActions,
            );
          }

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

      const deferredSuffix = deferred > 0 ? `, ${deferred} deferred to a later run (auto-send cap)` : "";
      console.log(`  [${account.email}] Rule "${rule.name}": applied actions to ${applied} match(es)${failed > 0 ? `, ${failed} failed` : ""}${deferredSuffix}.`);
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
