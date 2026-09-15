import "./env.js";
import { prisma } from "./db.js";
import { connectImap, requireEnv } from "./imap-connect.js";
import { applyRuleActions, type RuleAction } from "./rules/actions.js";
import { RECEIPT_PATTERN } from "./text-patterns.js";

/**
 * Deterministic-only port of inbox-zero's real "Deep Clean" (researched
 * from its actual source before building this): a hybrid rule+AI pipeline
 * running as a QStash-queued background job against the Gmail API,
 * choosing archive-vs-keep per thread via an LLM fallback after a
 * deterministic skip cascade (starred/sent/attachment/receipt/calendar-
 * timing/newsletter-unsubscribe), applied via Gmail label mutations
 * (INBOX/UNREAD removal, custom "Processed" labels), fully undoable,
 * never deletes anything.
 *
 * What ported cleanly: the skip-cascade concept and the "never delete,
 * always reversible" guarantee. What didn't: the Gmail-category-label
 * auto-archive heuristic (Social/Promotions/Updates/Forums have no IMAP
 * equivalent), the QStash queue/rate-limiting scaffolding (irrelevant here
 * -- this app's whole premise is that IMAP doesn't have Gmail's per-minute
 * quota problem), and the AI-decision step for v1 -- deliberately skipped
 * to avoid another live-AI-dependent bulk feature on top of an already
 * demonstrated flaky local Ollama server (see Cold Email Blocker's
 * write-up); age threshold + deterministic skip toggles alone are still a
 * genuinely useful bulk-cleanup tool on their own. "Skip has attachment"
 * (part of inbox-zero's real skip list) is also NOT implemented -- this
 * app doesn't track attachment presence at sync time, and checking it
 * live per-candidate would mean a BODYSTRUCTURE fetch per message, adding
 * real latency to every run; a known, documented gap, not an oversight.
 */
async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");

  const action = process.env.DEEP_CLEAN_ACTION === "markRead" ? "markRead" : "archive";
  const olderThanDaysRaw = process.env.DEEP_CLEAN_OLDER_THAN_DAYS;
  const olderThanDays = olderThanDaysRaw && olderThanDaysRaw !== "all" ? Number(olderThanDaysRaw) : null;
  const skipStarred = process.env.DEEP_CLEAN_SKIP_STARRED !== "false";
  const skipSent = process.env.DEEP_CLEAN_SKIP_SENT !== "false";
  const skipReceipts = process.env.DEEP_CLEAN_SKIP_RECEIPTS !== "false";

  const cutoff = olderThanDays !== null ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000) : null;

  const candidates = await prisma.message.findMany({
    where: {
      inInbox: true,
      ...(cutoff ? { date: { lt: cutoff } } : {}),
    },
    select: { id: true, uid: true, subject: true, fromAddress: true, flags: true, labels: true },
  });

  const targets = candidates.filter((message) => {
    if (skipStarred && message.flags.includes("\\Flagged")) return false;
    if (skipSent && message.labels.includes("\\Sent")) return false;
    if (skipReceipts) {
      const haystack = `${message.subject ?? ""} ${message.fromAddress ?? ""}`;
      if (RECEIPT_PATTERN.test(haystack)) return false;
    }
    return true;
  });

  console.log(
    `Deep Clean: ${candidates.length} candidate(s) older than ${olderThanDays ?? "any age"} day(s), ${targets.length} after skip filters (action: ${action}).`,
  );

  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const client = await connectImap(gmailAddress);
  const lock = await client.getMailboxLock("INBOX");

  const ruleAction: RuleAction = action === "archive" ? { type: "archive" } : { type: "markRead" };

  let applied = 0;
  let failed = 0;
  try {
    for (const message of targets) {
      try {
        await applyRuleActions(client, message.uid, [ruleAction]);
        if (action === "archive") {
          await prisma.message.update({ where: { id: message.id }, data: { inInbox: false } });
        }
        applied++;
        if (applied % 25 === 0) console.log(`...${applied}/${targets.length} done`);
      } catch (error) {
        console.error(`Failed on "${message.subject}":`, error instanceof Error ? error.message : error);
        failed++;
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  console.log(`Deep Clean complete: ${applied} processed${failed > 0 ? `, ${failed} failed` : ""}.`);
}

main()
  .catch((error) => {
    console.error("deep-clean failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
