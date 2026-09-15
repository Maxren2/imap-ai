import { prisma } from "@imap-ai/core/db";

export interface NoReplyThread {
  id: string;
  subject: string | null;
  toAddress: string | null;
  toName: string | null;
  dateIso: string;
}

/**
 * Threads where the most recent message is one we sent -- i.e. we're
 * still waiting on a reply. Per Gmail thread ID, only the single latest
 * message across the whole thread matters (DISTINCT ON ... ORDER BY date
 * DESC), then filtered to the threads where that latest message carries
 * the "\Sent" label. A thread with only one message we sent (true cold
 * outreach, never replied to at all) counts too, matching inbox-zero's
 * own definition.
 *
 * Note the doubled backslash in '\\Sent' below -- see the longer comment
 * on stats/queries.ts's getVolumeOverTime for why a single backslash
 * silently breaks this (cooks away to 'Sent', matching nothing).
 */
export async function getNoReplyThreads(limit = 50): Promise<NoReplyThread[]> {
  const rows = await prisma.$queryRaw<
    { id: string; subject: string | null; toAddress: string | null; toName: string | null; date: Date }[]
  >`
    SELECT id, subject, "toAddress", "toName", date
    FROM (
      SELECT DISTINCT ON ("gmailThreadId") id, subject, "toAddress", "toName", date, labels
      FROM "Message"
      WHERE "gmailThreadId" IS NOT NULL
      ORDER BY "gmailThreadId", date DESC
    ) latest
    WHERE '\\Sent' = ANY(labels)
    ORDER BY date DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    toAddress: row.toAddress || null,
    toName: row.toName,
    dateIso: row.date.toISOString(),
  }));
}
