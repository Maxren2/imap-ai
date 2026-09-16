"use server";

import { prisma } from "@imap-ai/core/db";
import { revalidatePath } from "next/cache";
import { archiveMessages } from "@/app/mail-actions";
import { SENDER_PAGE_SIZE } from "@/lib/constants";
import { getActiveEmailAccount } from "@/lib/session";

export interface ArchiveCandidateRow {
  fromAddress: string;
  fromName: string | null;
  lastDateIso: string;
  inboxCount: number;
  unreadCount: number;
}

export interface ArchiveCandidateCursor {
  inboxCount: number;
  fromAddress: string;
}

/**
 * One page of senders ranked by how many of their messages are still
 * sitting in the inbox (not total message count, unlike Bulk Unsubscribe's
 * listSenders -- a sender already fully archived isn't an archive
 * candidate at all, so HAVING excludes them rather than just sorting them
 * last). Compound keyset cursor over the same aggregate-sort problem as
 * listSenders -- see that function's comment for why a CTE.
 */
export async function listArchiveCandidates(cursor?: ArchiveCandidateCursor): Promise<ArchiveCandidateRow[]> {
  const account = await getActiveEmailAccount();
  const rows = await prisma.$queryRaw<
    {
      fromAddress: string;
      fromName: string | null;
      lastDate: Date;
      inboxCount: bigint;
      unreadCount: bigint;
    }[]
  >`
    WITH agg AS (
      SELECT
        "fromAddress",
        (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
        MAX(date) AS "lastDate",
        COUNT(*) FILTER (WHERE "inInbox" = true) AS "inboxCount",
        COUNT(*) FILTER (WHERE "inInbox" = true AND NOT ('\\Seen' = ANY(flags))) AS "unreadCount"
      FROM "Message"
      JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
      WHERE "fromAddress" IS NOT NULL AND "Mailbox"."accountId" = ${account.id}
      GROUP BY "fromAddress"
      HAVING COUNT(*) FILTER (WHERE "inInbox" = true) > 0
    )
    SELECT * FROM agg
    WHERE ${cursor === undefined}
       OR "inboxCount" < ${cursor?.inboxCount ?? 0}
       OR ("inboxCount" = ${cursor?.inboxCount ?? 0} AND "fromAddress" > ${cursor?.fromAddress ?? ""})
    ORDER BY "inboxCount" DESC, "fromAddress" ASC
    LIMIT ${SENDER_PAGE_SIZE}
  `;

  return rows.map((row) => ({
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    lastDateIso: row.lastDate.toISOString(),
    inboxCount: Number(row.inboxCount),
    unreadCount: Number(row.unreadCount),
  }));
}

export async function countArchiveCandidates(): Promise<number> {
  const account = await getActiveEmailAccount();
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM (
      SELECT "fromAddress" FROM "Message"
      JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
      WHERE "fromAddress" IS NOT NULL AND "Mailbox"."accountId" = ${account.id}
      GROUP BY "fromAddress"
      HAVING COUNT(*) FILTER (WHERE "inInbox" = true) > 0
    ) t
  `;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Archives every still-inboxed message from the given senders in one go
 * (one IMAP connection reused across all of them, via mail-actions.ts's
 * archiveMessages) rather than one connection per sender.
 */
export async function archiveSenders(fromAddresses: string[]): Promise<{ archived: number }> {
  if (fromAddresses.length === 0) return { archived: 0 };

  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: { fromAddress: { in: fromAddresses }, inInbox: true, mailbox: { accountId: account.id } },
    select: { id: true },
  });

  const result = await archiveMessages(messages.map((m) => m.id));
  revalidatePath("/bulk-archive");
  return result;
}
