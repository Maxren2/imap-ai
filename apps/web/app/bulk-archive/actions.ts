"use server";

import { prisma } from "@imap-ai/core/db";
import { revalidatePath } from "next/cache";
import { archiveMessages } from "@/app/mail-actions";

export interface ArchiveCandidateRow {
  fromAddress: string;
  fromName: string | null;
  lastDateIso: string;
  inboxCount: number;
  unreadCount: number;
}

/**
 * Senders ranked by how many of their messages are still sitting in the
 * inbox (not total message count, unlike Bulk Unsubscribe's listSenders --
 * a sender already fully archived isn't an archive candidate at all, so
 * HAVING excludes them rather than just sorting them last).
 */
export async function listArchiveCandidates(): Promise<ArchiveCandidateRow[]> {
  const rows = await prisma.$queryRaw<
    {
      fromAddress: string;
      fromName: string | null;
      lastDate: Date;
      inboxCount: bigint;
      unreadCount: bigint;
    }[]
  >`
    SELECT
      "fromAddress",
      (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
      MAX(date) AS "lastDate",
      COUNT(*) FILTER (WHERE "inInbox" = true) AS "inboxCount",
      COUNT(*) FILTER (WHERE "inInbox" = true AND NOT ('\\Seen' = ANY(flags))) AS "unreadCount"
    FROM "Message"
    WHERE "fromAddress" IS NOT NULL
    GROUP BY "fromAddress"
    HAVING COUNT(*) FILTER (WHERE "inInbox" = true) > 0
    ORDER BY "inboxCount" DESC
    LIMIT 300
  `;

  return rows.map((row) => ({
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    lastDateIso: row.lastDate.toISOString(),
    inboxCount: Number(row.inboxCount),
    unreadCount: Number(row.unreadCount),
  }));
}

/**
 * Archives every still-inboxed message from the given senders in one go
 * (one IMAP connection reused across all of them, via mail-actions.ts's
 * archiveMessages) rather than one connection per sender.
 */
export async function archiveSenders(fromAddresses: string[]): Promise<{ archived: number }> {
  if (fromAddresses.length === 0) return { archived: 0 };

  const messages = await prisma.message.findMany({
    where: { fromAddress: { in: fromAddresses }, inInbox: true },
    select: { id: true },
  });

  const result = await archiveMessages(messages.map((m) => m.id));
  revalidatePath("/bulk-archive");
  return result;
}
