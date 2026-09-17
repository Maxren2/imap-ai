"use server";

import { prisma } from "@imap-ai/core/db";
import { createAccountSmtpTransport } from "@imap-ai/core/mail-provider";
import { performOneClickUnsubscribe, isSafeHttpUrl } from "@imap-ai/core/unsubscribe";
import { revalidatePath } from "next/cache";
import { SENDER_PAGE_SIZE } from "@/lib/constants";
import { getActiveEmailAccount } from "@/lib/session";

export interface SenderRow {
  fromAddress: string;
  fromName: string | null;
  messageCount: number;
  unreadCount: number;
  inboxCount: number;
  listUnsubscribeUrl: string | null;
  listUnsubscribeMailto: string | null;
  listUnsubscribeOneClick: boolean;
  status: string;
}

export interface SenderCursor {
  messageCount: number;
  fromAddress: string;
}

/**
 * One page of senders ranked by message count, with that sender's most
 * recent unsubscribe info (Postgres ARRAY_AGG ... ORDER BY date DESC picks
 * the latest non-null value per group in one query rather than a per-sender
 * follow-up query). Scoped to the active account via a Mailbox join --
 * otherwise this would mix every linked account's senders together.
 *
 * Keyset pagination over an *aggregate* sort key: `messageCount DESC` alone
 * isn't a stable cursor (ties are common -- many senders share the same
 * small count), so the cursor is the compound `(messageCount, fromAddress)`
 * pair, with `fromAddress ASC` as the tiebreaker on both the ORDER BY and
 * the WHERE comparison. Wrapped in a CTE because Postgres won't let a WHERE
 * clause reference an aggregate alias directly (that needs HAVING, and
 * HAVING can't express "less than OR (equal AND tiebreak)" cleanly against
 * a cursor that's already resolved before this query runs).
 *
 * Only returns senders with a usable unsubscribe method (one-click, link,
 * or mailto) on their most recent message -- a sender with none is nothing
 * this page can act on, so listing it here would just be noise the user
 * has to scroll past. Filtered in the outer SELECT (after the aggregate
 * already picked each sender's latest non-null value), not in the CTE's
 * WHERE, for the same "can't filter on an aggregate alias without HAVING"
 * reason the cursor above is structured this way.
 */
export async function listSenders(cursor?: SenderCursor): Promise<SenderRow[]> {
  const account = await getActiveEmailAccount();
  const rows = await prisma.$queryRaw<
    {
      fromAddress: string;
      fromName: string | null;
      messageCount: bigint;
      unreadCount: bigint;
      inboxCount: bigint;
      listUnsubscribeUrl: string | null;
      listUnsubscribeMailto: string | null;
      listUnsubscribeOneClick: boolean | null;
    }[]
  >`
    WITH agg AS (
      SELECT
        "fromAddress",
        (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
        COUNT(*) AS "messageCount",
        COUNT(*) FILTER (WHERE NOT ('\\Seen' = ANY(flags))) AS "unreadCount",
        COUNT(*) FILTER (WHERE "inInbox" = true) AS "inboxCount",
        (ARRAY_AGG("listUnsubscribeUrl" ORDER BY date DESC))[1] AS "listUnsubscribeUrl",
        (ARRAY_AGG("listUnsubscribeMailto" ORDER BY date DESC))[1] AS "listUnsubscribeMailto",
        (ARRAY_AGG("listUnsubscribeOneClick" ORDER BY date DESC))[1] AS "listUnsubscribeOneClick"
      FROM "Message"
      JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
      WHERE "fromAddress" IS NOT NULL AND "Mailbox"."accountId" = ${account.id}
      GROUP BY "fromAddress"
    )
    SELECT * FROM agg
    WHERE ("listUnsubscribeUrl" IS NOT NULL OR "listUnsubscribeMailto" IS NOT NULL)
      AND (
        ${cursor === undefined}
        OR "messageCount" < ${cursor?.messageCount ?? 0}
        OR ("messageCount" = ${cursor?.messageCount ?? 0} AND "fromAddress" > ${cursor?.fromAddress ?? ""})
      )
    ORDER BY "messageCount" DESC, "fromAddress" ASC
    LIMIT ${SENDER_PAGE_SIZE}
  `;

  const statuses = await prisma.senderStatus.findMany({
    where: { accountId: account.id },
    select: { senderAddress: true, status: true },
  });
  const statusByAddress = new Map(statuses.map((s) => [s.senderAddress, s.status]));

  return rows.map((row) => ({
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    messageCount: Number(row.messageCount),
    unreadCount: Number(row.unreadCount),
    inboxCount: Number(row.inboxCount),
    listUnsubscribeUrl: row.listUnsubscribeUrl,
    listUnsubscribeMailto: row.listUnsubscribeMailto,
    listUnsubscribeOneClick: row.listUnsubscribeOneClick ?? false,
    status: statusByAddress.get(row.fromAddress) ?? "unhandled",
  }));
}

/**
 * Same "does this sender's latest message carry a usable unsubscribe
 * method" filter as listSenders -- a plain COUNT(DISTINCT "fromAddress")
 * would overcount relative to what the page actually lists otherwise.
 * Mirrors listSenders's ARRAY_AGG-latest-value approach rather than a
 * cheaper EXISTS, since "latest message's value" (not "any message ever
 * had one") is what determines listability.
 */
export async function countSenders(): Promise<number> {
  const account = await getActiveEmailAccount();
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    WITH agg AS (
      SELECT
        "fromAddress",
        (ARRAY_AGG("listUnsubscribeUrl" ORDER BY date DESC))[1] AS "listUnsubscribeUrl",
        (ARRAY_AGG("listUnsubscribeMailto" ORDER BY date DESC))[1] AS "listUnsubscribeMailto"
      FROM "Message"
      JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
      WHERE "fromAddress" IS NOT NULL AND "Mailbox"."accountId" = ${account.id}
      GROUP BY "fromAddress"
    )
    SELECT COUNT(*) as count FROM agg
    WHERE "listUnsubscribeUrl" IS NOT NULL OR "listUnsubscribeMailto" IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

async function setSenderStatus(accountId: string, senderAddress: string, status: string) {
  await prisma.senderStatus.upsert({
    where: { accountId_senderAddress: { accountId, senderAddress } },
    update: { status },
    create: { accountId, senderAddress, status },
  });
}

export type UnsubscribeResult =
  | { mode: "one-click"; status: "unsubscribed" }
  | { mode: "mailto"; status: "unsubscribed" }
  | { mode: "manual-link"; url: string; status: "unsubscribed" }
  | { mode: "unavailable" };

/**
 * Unsubscribes from a sender using the best available mechanism: RFC 8058
 * one-click POST when supported, otherwise sending an actual unsubscribe
 * email via SMTP to a mailto: address, otherwise handing back a manual
 * link for the browser to open (the only case this app can't fully
 * automate -- opening a page still requires the user's own click).
 */
export async function unsubscribeSender(fromAddress: string): Promise<UnsubscribeResult> {
  const account = await getActiveEmailAccount();
  const latest = await prisma.message.findFirst({
    where: { fromAddress, mailbox: { accountId: account.id } },
    orderBy: { date: "desc" },
    select: { listUnsubscribeUrl: true, listUnsubscribeMailto: true, listUnsubscribeOneClick: true },
  });

  if (!latest || (!latest.listUnsubscribeUrl && !latest.listUnsubscribeMailto)) {
    return { mode: "unavailable" };
  }

  if (latest.listUnsubscribeOneClick && latest.listUnsubscribeUrl) {
    try {
      const result = await performOneClickUnsubscribe(latest.listUnsubscribeUrl);
      if (result.ok) {
        await setSenderStatus(account.id, fromAddress, "unsubscribed");
        revalidatePath("/bulk-unsubscribe");
        return { mode: "one-click", status: "unsubscribed" };
      }
    } catch (error) {
      console.error(`One-click unsubscribe failed for ${fromAddress}:`, error);
    }
    // Falls through to a manual link/mailto below if the POST didn't
    // succeed (e.g. the sender advertised one-click but the endpoint
    // rejected it, or the URL failed the SSRF check).
  }

  if (latest.listUnsubscribeUrl && (await isSafeHttpUrl(latest.listUnsubscribeUrl))) {
    await setSenderStatus(account.id, fromAddress, "unsubscribed");
    revalidatePath("/bulk-unsubscribe");
    return { mode: "manual-link", url: latest.listUnsubscribeUrl, status: "unsubscribed" };
  }

  if (latest.listUnsubscribeMailto) {
    const to = latest.listUnsubscribeMailto.replace(/^mailto:/i, "").split("?")[0];
    const transport = await createAccountSmtpTransport(account);
    await transport.sendMail({ from: account.email, to, subject: "unsubscribe", text: "unsubscribe" });
    await setSenderStatus(account.id, fromAddress, "unsubscribed");
    revalidatePath("/bulk-unsubscribe");
    return { mode: "mailto", status: "unsubscribed" };
  }

  return { mode: "unavailable" };
}
