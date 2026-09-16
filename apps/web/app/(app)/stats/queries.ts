import { prisma } from "@imap-ai/core/db";
import { categorizeSender, SENDER_CATEGORIES, type SenderCategory } from "@/lib/analytics/categorize-sender";

export interface VolumeDay {
  day: string; // ISO date
  received: number;
  sent: number;
}

/**
 * Daily received/sent counts for the last 90 days, entirely from the
 * local mirror -- no live Gmail calls (unlike inbox-zero's response-time
 * widget, which does hit the Gmail API; deliberately not building that
 * one for v1, see DESIGN.md). "Sent" is read off the `labels` array
 * (Gmail's \Sent label), the same signal the "Sent by me" example rule
 * already uses elsewhere in this codebase.
 *
 * IMPORTANT: inside a $queryRaw template literal, a Gmail system label
 * like \Sent/\Seen/\Inbox MUST be written with a doubled backslash
 * ('\\Sent') -- a single backslash ('\Sent') is not a recognized JS
 * escape sequence, so the template literal silently cooks it down to
 * 'Sent' (backslash dropped), which then matches nothing in Postgres.
 * This was shipped broken for a while (found while building the No-Reply
 * feature): getVolumeOverTime's "sent" bucket, getTopSenders' and
 * getCategoryBreakdown's self-sent-mail exclusion, and the Unread counts
 * in bulk-archive/actions.ts and bulk-unsubscribe/actions.ts (same
 * '\Seen' mistake) were all silently no-ops. Caught by directly comparing
 * a raw SQL COUNT(*) against a known-correct number, not by a chart
 * "looking plausible" -- see DESIGN.md's phase-9 write-up.
 */
export async function getVolumeOverTime(accountId: string): Promise<VolumeDay[]> {
  const rows = await prisma.$queryRaw<{ day: Date; received: bigint; sent: bigint }[]>`
    SELECT
      date_trunc('day', date) AS day,
      COUNT(*) FILTER (WHERE NOT ('\\Sent' = ANY(labels))) AS received,
      COUNT(*) FILTER (WHERE '\\Sent' = ANY(labels)) AS sent
    FROM "Message"
    JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
    WHERE date >= NOW() - INTERVAL '90 days' AND "Mailbox"."accountId" = ${accountId}
    GROUP BY day
    ORDER BY day ASC
  `;

  return rows.map((row) => ({
    day: row.day.toISOString().slice(0, 10),
    received: Number(row.received),
    sent: Number(row.sent),
  }));
}

export interface TopSenderRow {
  fromAddress: string;
  fromName: string | null;
  count: number;
}

/** Top senders by message count, excluding the account's own sent mail. */
export async function getTopSenders(accountId: string, limit = 10): Promise<TopSenderRow[]> {
  const rows = await prisma.$queryRaw<{ fromAddress: string; fromName: string | null; count: bigint }[]>`
    SELECT
      "fromAddress",
      (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
      COUNT(*) AS count
    FROM "Message"
    JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
    WHERE "fromAddress" IS NOT NULL AND NOT ('\\Sent' = ANY(labels)) AND "Mailbox"."accountId" = ${accountId}
    GROUP BY "fromAddress"
    ORDER BY count DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({ fromAddress: row.fromAddress, fromName: row.fromName, count: Number(row.count) }));
}

export interface RuleStatRow {
  name: string;
  matchCount: number;
}

export async function getRuleStats(accountId: string): Promise<RuleStatRow[]> {
  const rules = await prisma.rule.findMany({
    where: { accountId },
    select: { name: true, _count: { select: { matches: true } } },
    orderBy: { name: "asc" },
  });
  return rules.map((rule) => ({ name: rule.name, matchCount: rule._count.matches }));
}

export interface CategoryBreakdownRow {
  category: SenderCategory;
  senderCount: number;
  messageCount: number;
}

interface SenderAggRow {
  fromAddress: string;
  fromName: string | null;
  lastSubject: string | null;
  messageCount: bigint;
  hasUnsubscribe: boolean;
}

async function getSenderAggRows(accountId: string): Promise<SenderAggRow[]> {
  return prisma.$queryRaw<SenderAggRow[]>`
    SELECT
      "fromAddress",
      (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
      (ARRAY_AGG(subject ORDER BY date DESC))[1] AS "lastSubject",
      COUNT(*) AS "messageCount",
      BOOL_OR("listUnsubscribeUrl" IS NOT NULL OR "listUnsubscribeMailto" IS NOT NULL) AS "hasUnsubscribe"
    FROM "Message"
    JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
    WHERE "fromAddress" IS NOT NULL AND NOT ('\\Sent' = ANY(labels)) AND "Mailbox"."accountId" = ${accountId}
    GROUP BY "fromAddress"
    ORDER BY "messageCount" DESC
    LIMIT 300
  `;
}

/** A manual override (see /stats' hand-correction UI) always wins over the heuristic guess. */
function isSenderCategory(value: string): value is SenderCategory {
  return (SENDER_CATEGORIES as string[]).includes(value);
}

async function getOverridesMap(accountId: string): Promise<Map<string, SenderCategory>> {
  const overrides = await prisma.senderCategoryOverride.findMany({
    where: { accountId },
    select: { senderAddress: true, category: true },
  });
  const map = new Map<string, SenderCategory>();
  for (const override of overrides) {
    if (isSenderCategory(override.category)) map.set(override.senderAddress, override.category);
  }
  return map;
}

/**
 * Sender-category breakdown via the static heuristic in
 * lib/analytics/categorize-sender.ts (overridden per-sender where the user
 * has hand-corrected one), applied over the same top-300 senders-by-volume
 * window used by Bulk Unsubscribe -- a full-mailbox pass isn't needed for a
 * breakdown chart, and keeps this query cheap.
 */
export async function getCategoryBreakdown(accountId: string): Promise<CategoryBreakdownRow[]> {
  const [rows, overrides] = await Promise.all([getSenderAggRows(accountId), getOverridesMap(accountId)]);

  const totals = new Map<SenderCategory, { senderCount: number; messageCount: number }>(
    SENDER_CATEGORIES.map((category) => [category, { senderCount: 0, messageCount: 0 }]),
  );

  for (const row of rows) {
    const category =
      overrides.get(row.fromAddress) ??
      categorizeSender({
        fromAddress: row.fromAddress,
        fromName: row.fromName,
        lastSubject: row.lastSubject,
        hasUnsubscribe: row.hasUnsubscribe,
      });
    const bucket = totals.get(category)!;
    bucket.senderCount += 1;
    bucket.messageCount += Number(row.messageCount);
  }

  return SENDER_CATEGORIES.map((category) => ({ category, ...totals.get(category)! }));
}

export interface SenderCategoryRow {
  fromAddress: string;
  fromName: string | null;
  messageCount: number;
  category: SenderCategory;
  isOverridden: boolean;
}

/**
 * Same top-300 senders as the breakdown above, but as individual rows for
 * the hand-correction table -- each carries its current *effective*
 * category (override if set, else the heuristic guess) and whether that's
 * a manual override, so the UI can show the dropdown pre-selected
 * correctly and distinguish "someone corrected this" from "heuristic
 * guess" at a glance.
 */
export async function getSenderCategories(accountId: string, limit = 50): Promise<SenderCategoryRow[]> {
  const [rows, overrides] = await Promise.all([getSenderAggRows(accountId), getOverridesMap(accountId)]);

  return rows.slice(0, limit).map((row) => {
    const override = overrides.get(row.fromAddress);
    const category =
      override ??
      categorizeSender({
        fromAddress: row.fromAddress,
        fromName: row.fromName,
        lastSubject: row.lastSubject,
        hasUnsubscribe: row.hasUnsubscribe,
      });
    return {
      fromAddress: row.fromAddress,
      fromName: row.fromName,
      messageCount: Number(row.messageCount),
      category,
      isOverridden: override !== undefined,
    };
  });
}
