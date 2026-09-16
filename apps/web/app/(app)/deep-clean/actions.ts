"use server";

import { prisma } from "@imap-ai/core/db";
import { RECEIPT_PATTERN } from "@imap-ai/core/text-patterns";
import { runNpmScript, getLatestBackgroundRuns } from "@/lib/background-run";
import type { BackgroundRunRow } from "@/lib/background-run";
import { getActiveEmailAccount } from "@/lib/session";

export interface DeepCleanOptions {
  action: "archive" | "markRead";
  olderThanDays: number | null; // null = any age
  skipStarred: boolean;
  skipSent: boolean;
  skipReceipts: boolean;
}

function cutoffFor(olderThanDays: number | null): Date | null {
  return olderThanDays !== null ? new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000) : null;
}

/**
 * Read-only count of what a run with these options would touch -- shown
 * before the user commits to triggering the real (IMAP-mutating)
 * background run, same "verify before mutating" instinct as everywhere
 * else in this app. Mirrors deep-clean.ts's own candidate filter exactly
 * (same three skip toggles, same RECEIPT_PATTERN import) so the preview
 * count is never a promise the real run doesn't keep.
 */
export async function previewDeepClean(options: DeepCleanOptions): Promise<number> {
  const account = await getActiveEmailAccount();
  const cutoff = cutoffFor(options.olderThanDays);
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM "Message"
    JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
    WHERE "inInbox" = true
      AND "Mailbox"."accountId" = ${account.id}
      AND (${cutoff}::timestamp IS NULL OR date < ${cutoff}::timestamp)
      AND NOT (${options.skipStarred} AND '\\Flagged' = ANY(flags))
      AND NOT (${options.skipSent} AND '\\Sent' = ANY(labels))
      AND NOT (
        ${options.skipReceipts}
        AND (subject ~* ${RECEIPT_PATTERN.source} OR COALESCE("fromAddress", '') ~* ${RECEIPT_PATTERN.source})
      )
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function triggerDeepClean(options: DeepCleanOptions): Promise<void> {
  const account = await getActiveEmailAccount();
  await runNpmScript("deep-clean", "deep-clean", "/deep-clean", account.id, {
    DEEP_CLEAN_ACTION: options.action,
    DEEP_CLEAN_OLDER_THAN_DAYS: options.olderThanDays === null ? "all" : String(options.olderThanDays),
    DEEP_CLEAN_SKIP_STARRED: String(options.skipStarred),
    DEEP_CLEAN_SKIP_SENT: String(options.skipSent),
    DEEP_CLEAN_SKIP_RECEIPTS: String(options.skipReceipts),
  });
}

export type { BackgroundRunRow };

export async function getLatestDeepCleanRuns(): Promise<BackgroundRunRow[]> {
  const account = await getActiveEmailAccount();
  return getLatestBackgroundRuns(account.id, ["deep-clean"]);
}
