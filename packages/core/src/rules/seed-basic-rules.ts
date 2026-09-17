import "../env.js";
import { prisma } from "../db.js";
import { resolveAccounts } from "../account-scope.js";
import type { RuleActions } from "./actions.js";

/**
 * A handful of common inbox-cleanup rules, structurally inspired by
 * inbox-zero's default rule categories -- checked directly against its
 * real source (apps/web/utils/rule/consts.ts's STANDARD_CATEGORY_SYSTEM_TYPES:
 * TO_REPLY, NEWSLETTER, MARKETING, CALENDAR, RECEIPT, NOTIFICATION,
 * COLD_EMAIL), not guessed. Six of those seven are seeded here (same
 * shape as before: AI-prompt match, label [+archive]), rewritten fresh
 * for this project's own schema rather than ported -- prompt wording is
 * original, not copied from inbox-zero's source. Cold Email is
 * deliberately not part of this set: it's already its own dedicated
 * feature (`rules:seed-cold-email`, systemType-flagged, with its own
 * "Mark Not Cold" exception list), not a plain label rule like these six.
 *
 * Two real simplifications vs. inbox-zero's actual "To Reply" behavior,
 * not replicated here: inbox-zero evaluates it per-*thread* and updates
 * the label as a conversation progresses (needs the same thread-reply-
 * tracking infrastructure this project's Reply Zero equivalent was
 * already ruled out for lacking); it also auto-drafts a reply by default
 * (`draftReply: true`). This version is message-level, label-only --
 * still useful (flags mail worth a personal reply), just not the same
 * live-updating, auto-drafting feature. Add a `draft` action by hand on
 * the Rules page if you want that piece specifically (built separately,
 * see rules/sending-actions.ts) -- not defaulted on here, since unlike a
 * label, it costs a real AI call and writes a real Drafts entry per match.
 *
 * Safe to re-run: upserts by name. Enabled by default -- the user asked
 * for these to be active out of the box rather than needing a manual
 * per-rule opt-in after every first link.
 */
async function main() {
  const accounts = await resolveAccounts();
  if (accounts.length === 0) {
    console.log("No linked accounts.");
    return;
  }

  const rules: { name: string; aiPrompt: string; actions: RuleActions }[] = [
    {
      name: "Newsletter",
      aiPrompt:
        "The email is a newsletter or subscribed content digest (a recurring publication you opted into), not a one-off personal or transactional message.",
      actions: [{ type: "label", label: "Newsletter" }, { type: "archive" }],
    },
    {
      name: "Marketing",
      aiPrompt:
        "The email is a promotional or marketing message -- a sale, discount, product announcement, or ad -- and not something that requires account action, a purchase confirmation, or a service update.",
      actions: [{ type: "label", label: "Marketing" }, { type: "archive" }],
    },
    {
      name: "Receipt",
      aiPrompt:
        "The email is a purchase receipt, invoice, or payment confirmation for something already bought or paid.",
      actions: [{ type: "label", label: "Receipt" }],
    },
    {
      name: "Notification",
      aiPrompt:
        "The email is an automated notification from a service or platform (e.g. a status update, activity alert, or system message) that doesn't need a reply.",
      actions: [{ type: "label", label: "Notification" }, { type: "archive" }],
    },
    {
      name: "Calendar",
      aiPrompt: "The email is related to scheduling -- a meeting invite, calendar notification, reminder, or reschedule/cancellation of one.",
      actions: [{ type: "label", label: "Calendar" }],
    },
    {
      name: "To Reply",
      aiPrompt:
        "The email is a personal or work message that's asking you something, or otherwise genuinely expects a reply from you -- not an automated notification, receipt, or marketing message.",
      actions: [{ type: "label", label: "To Reply" }],
    },
  ];

  for (const account of accounts) {
    for (const { name, aiPrompt, actions } of rules) {
      await prisma.rule.upsert({
        where: { accountId_name: { accountId: account.id, name } },
        update: { aiPrompt, actions, enabled: true },
        create: { accountId: account.id, name, aiPrompt, actions, enabled: true },
      });
      console.log(`[${account.email}] Upserted rule "${name}" (enabled).`);
    }
  }
}

main()
  .catch((error) => {
    console.error("rules:seed-basic failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
