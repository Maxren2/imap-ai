"use server";

import { prisma } from "@imap-ai/core/db";
import { createSmtpTransport } from "@imap-ai/core/smtp";
import { performOneClickUnsubscribe, isSafeHttpUrl } from "@imap-ai/core/unsubscribe";
import { requireEnv } from "@imap-ai/core/imap-connect";
import { revalidatePath } from "next/cache";

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

/**
 * One row per distinct sender, with counts and that sender's most recent
 * unsubscribe info (Postgres ARRAY_AGG ... ORDER BY date DESC picks the
 * latest non-null value per group in one query rather than a per-sender
 * follow-up query). Single-account MVP scope, so no account filter here --
 * same simplification used elsewhere in this codebase.
 */
export async function listSenders(): Promise<SenderRow[]> {
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
    SELECT
      "fromAddress",
      (ARRAY_AGG("fromName" ORDER BY date DESC))[1] AS "fromName",
      COUNT(*) AS "messageCount",
      COUNT(*) FILTER (WHERE NOT ('\Seen' = ANY(flags))) AS "unreadCount",
      COUNT(*) FILTER (WHERE "inInbox" = true) AS "inboxCount",
      (ARRAY_AGG("listUnsubscribeUrl" ORDER BY date DESC))[1] AS "listUnsubscribeUrl",
      (ARRAY_AGG("listUnsubscribeMailto" ORDER BY date DESC))[1] AS "listUnsubscribeMailto",
      (ARRAY_AGG("listUnsubscribeOneClick" ORDER BY date DESC))[1] AS "listUnsubscribeOneClick"
    FROM "Message"
    WHERE "fromAddress" IS NOT NULL
    GROUP BY "fromAddress"
    ORDER BY "messageCount" DESC
    LIMIT 300
  `;

  const statuses = await prisma.senderStatus.findMany({ select: { senderAddress: true, status: true } });
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
  const latest = await prisma.message.findFirst({
    where: { fromAddress },
    orderBy: { date: "desc" },
    select: { listUnsubscribeUrl: true, listUnsubscribeMailto: true, listUnsubscribeOneClick: true },
  });

  if (!latest || (!latest.listUnsubscribeUrl && !latest.listUnsubscribeMailto)) {
    return { mode: "unavailable" };
  }

  const account = await prisma.account.findFirstOrThrow();

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
    const gmailAddress = requireEnv("GMAIL_ADDRESS");
    const transport = createSmtpTransport({
      user: gmailAddress,
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
      refreshToken: requireEnv("GOOGLE_REFRESH_TOKEN"),
    });
    await transport.sendMail({ from: gmailAddress, to, subject: "unsubscribe", text: "unsubscribe" });
    await setSenderStatus(account.id, fromAddress, "unsubscribed");
    revalidatePath("/bulk-unsubscribe");
    return { mode: "mailto", status: "unsubscribed" };
  }

  return { mode: "unavailable" };
}
