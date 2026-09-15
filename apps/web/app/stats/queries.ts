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
export async function getVolumeOverTime(): Promise<VolumeDay[]> {
  const rows = await prisma.$queryRaw<{ day: Date; received: bigint; sent: bigint }[]>`
    SELECT
      date_trunc('day', date) AS day,
      COUNT(*) FILTER (WHERE NOT ('\\Sent' = ANY(labels))) AS received,
      COUNT(*) FILTER (WHERE '\\Sent' = ANY(labels)) AS sent
    FROM "Message"
    WHERE date >= NOW() - INTERVAL '90 days'
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
export async function getTopSenders(limit = 10): Promise<TopSenderRow[]> {
  const rows = await prisma.$queryRaw<{ fromAddress: string; fromName: string | null; count: bigint }[]>`
    SELECT
      "fromAddress",
      (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
      COUNT(*) AS count
    FROM "Message"
    WHERE "fromAddress" IS NOT NULL AND NOT ('\\Sent' = ANY(labels))
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

export async function getRuleStats(): Promise<RuleStatRow[]> {
  const rules = await prisma.rule.findMany({
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

/**
 * Sender-category breakdown via the static heuristic in
 * lib/analytics/categorize-sender.ts, applied over the same top-300
 * senders-by-volume window used by Bulk Unsubscribe -- a full-mailbox
 * pass isn't needed for a breakdown chart, and keeps this query cheap.
 */
export async function getCategoryBreakdown(): Promise<CategoryBreakdownRow[]> {
  const rows = await prisma.$queryRaw<
    {
      fromAddress: string;
      fromName: string | null;
      lastSubject: string | null;
      messageCount: bigint;
      hasUnsubscribe: boolean;
    }[]
  >`
    SELECT
      "fromAddress",
      (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
      (ARRAY_AGG(subject ORDER BY date DESC))[1] AS "lastSubject",
      COUNT(*) AS "messageCount",
      BOOL_OR("listUnsubscribeUrl" IS NOT NULL OR "listUnsubscribeMailto" IS NOT NULL) AS "hasUnsubscribe"
    FROM "Message"
    WHERE "fromAddress" IS NOT NULL AND NOT ('\\Sent' = ANY(labels))
    GROUP BY "fromAddress"
    ORDER BY "messageCount" DESC
    LIMIT 300
  `;

  const totals = new Map<SenderCategory, { senderCount: number; messageCount: number }>(
    SENDER_CATEGORIES.map((category) => [category, { senderCount: 0, messageCount: 0 }]),
  );

  for (const row of rows) {
    const category = categorizeSender({
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
