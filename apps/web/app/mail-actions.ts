"use server";

import { prisma } from "@imap-ai/core/db";
import { connectAccountImap, createAccountSmtpTransport } from "@imap-ai/core/mail-provider";
import { applyRuleActions } from "@imap-ai/core/rules/actions";
import { ensureMessageBody } from "@imap-ai/core/body";
import { sendAndSaveToSent } from "@imap-ai/core/smtp";
import { replySubject, forwardSubject, buildForwardBody } from "@imap-ai/core/mail-format";
import type { EmailAccount } from "@imap-ai/core/prisma";
import { revalidatePath } from "next/cache";
import { runNpmScript, getLatestBackgroundRuns, cancelBackgroundRun } from "@/lib/background-run";
import type { BackgroundRunRow } from "@/lib/background-run";
import { INBOX_PAGE_SIZE } from "@/lib/constants";
import { getActiveEmailAccount } from "@/lib/session";

/**
 * Archives messages directly from the mail list (not via the rules
 * engine). Reuses the same IMAP MOVE-to-All-Mail logic as rule action
 * execution (see DESIGN.md section 8 for why: removing \Inbox via
 * X-GM-LABELS is a silent no-op on Gmail).
 *
 * After the real IMAP move, `inInbox` is set false locally so the Inbox
 * view updates immediately (see DESIGN.md section 11 -- `labels` can't be
 * used for this: Gmail omits "\Inbox" from X-GM-LABELS when a message is
 * fetched from within INBOX itself). The row's mailboxId/uid are
 * deliberately left pointing at the old INBOX position rather than
 * tracking the message into an "All Mail" mailbox we don't sync
 * separately; a moved message just won't be actionable via IMAP again
 * until a future sync properly tracks it there.
 */
async function archiveMessageRows(
  messages: { id: string; uid: number }[],
  account: EmailAccount,
): Promise<{ archived: number }> {
  if (messages.length === 0) return { archived: 0 };

  const client = await connectAccountImap(account);
  const lock = await client.getMailboxLock("INBOX");

  let archived = 0;
  try {
    for (const message of messages) {
      try {
        await applyRuleActions(client, message.uid, [{ type: "archive" }]);
        await prisma.message.update({ where: { id: message.id }, data: { inInbox: false } });
        archived++;
      } catch (error) {
        console.error(`Failed to archive message ${message.id}:`, error);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  revalidatePath("/");
  return { archived };
}

export async function archiveMessages(messageIds: string[]): Promise<{ archived: number }> {
  if (messageIds.length === 0) return { archived: 0 };
  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds }, mailbox: { accountId: account.id } },
    select: { id: true, uid: true },
  });
  return archiveMessageRows(messages, account);
}

/**
 * Archives every currently-inboxed message in each given thread, not just
 * the single (latest) message the grouped mail list actually displays for
 * that thread -- matches Gmail's own "archive conversation" semantics.
 * Without this, archiving a thread row would leave its earlier messages
 * silently still in the inbox, invisible in the UI (since the list only
 * ever shows one row per thread) but still there.
 */
export async function archiveThreads(threadIds: string[]): Promise<{ archived: number }> {
  if (threadIds.length === 0) return { archived: 0 };
  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: { gmailThreadId: { in: threadIds }, inInbox: true, mailbox: { accountId: account.id } },
    select: { id: true, uid: true },
  });
  return archiveMessageRows(messages, account);
}

/**
 * Applies a label to every currently-inboxed message from a sender --
 * called from chat's "Confirm Label" button (see labelSender in
 * lib/ai/tools.ts and chat-client.tsx), same "model proposes a count, a
 * real button executes" pattern as archiveSender/archiveMessages above.
 * Scoped to inInbox messages to match what the chat tool's count lookup
 * actually counted, and because every message this app tracks a uid for
 * lives in INBOX (single-mailbox MVP). Does not update the local
 * `Message.labels` column after a successful label -- rules:apply-actions
 * doesn't either (see packages/core/src/rules/apply-actions.ts), so this
 * stays consistent with that existing precedent rather than diverging for
 * one call site; a future sync will pick up the real label.
 */
export async function labelSenderMessages(fromAddress: string, label: string): Promise<{ labeled: number }> {
  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: { fromAddress, inInbox: true, mailbox: { accountId: account.id } },
    select: { id: true, uid: true },
  });
  if (messages.length === 0) return { labeled: 0 };

  const client = await connectAccountImap(account);
  const lock = await client.getMailboxLock("INBOX");

  let labeled = 0;
  try {
    for (const message of messages) {
      try {
        await applyRuleActions(client, message.uid, [{ type: "label", label }]);
        labeled++;
      } catch (error) {
        console.error(`Failed to label message ${message.id}:`, error);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return { labeled };
}

export interface ThreadListMessagePlain {
  id: string;
  gmailThreadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  dateIso: string;
  labels: string[];
  flags: string[];
  snippet: string | null;
  bodyFetched: boolean;
  messageCount: number;
  hasUnread: boolean;
}

interface ThreadRowRaw {
  id: string;
  gmailThreadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  date: Date;
  labels: string[];
  flags: string[];
  bodyText: string | null;
  bodyFetchedAt: Date | null;
  messageCount: bigint;
  hasUnread: boolean;
}

/**
 * One row per Gmail conversation thread (grouped by `gmailThreadId`, which
 * sync populates for essentially every message -- confirmed against real
 * data, not assumed), not one row per raw message, matching inbox-zero's
 * real inbox list. Each row carries the THREAD's latest message (for
 * display) plus `messageCount`/`hasUnread` computed across every message
 * in that thread, not just the one shown.
 *
 * The inner `latest` subquery intentionally does NOT apply the `beforeIso`
 * cutoff -- it must find each thread's true globally-latest message first
 * (Postgres `DISTINCT ON` requires the ORDER BY to start with the
 * DISTINCT ON column), then the outer query filters by that date. Filtering
 * inside the inner query would let a thread whose true latest message was
 * already shown on an earlier page re-surface using an older message as if
 * it were new, corrupting keyset pagination (skipped/duplicated threads).
 *
 * Keyset ("before this date") pagination -- see getInboxMessages's
 * original write-up (now superseded by this function) for why not
 * OFFSET-based.
 */
export async function getInboxThreads(beforeIso?: string, unreadOnly?: boolean): Promise<ThreadListMessagePlain[]> {
  const account = await getActiveEmailAccount();
  const cutoff = beforeIso ? new Date(beforeIso) : null;

  const rows = await prisma.$queryRaw<ThreadRowRaw[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("Message"."gmailThreadId")
        "Message".id, "Message"."gmailThreadId", subject, "fromAddress", "fromName", date, labels, flags, "bodyText", "bodyFetchedAt"
      FROM "Message"
      JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
      WHERE "inInbox" = true AND "Mailbox"."accountId" = ${account.id}
      ORDER BY "Message"."gmailThreadId", date DESC
    ),
    stats AS (
      SELECT "Message"."gmailThreadId", COUNT(*) AS "messageCount", BOOL_OR(NOT ('\\Seen' = ANY(flags))) AS "hasUnread"
      FROM "Message"
      JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
      WHERE "inInbox" = true AND "Mailbox"."accountId" = ${account.id}
      GROUP BY "Message"."gmailThreadId"
    )
    SELECT latest.*, stats."messageCount", stats."hasUnread"
    FROM latest
    JOIN stats ON stats."gmailThreadId" = latest."gmailThreadId"
    WHERE (${cutoff}::timestamp IS NULL OR latest.date < ${cutoff}::timestamp)
      AND (${unreadOnly ?? false} = false OR stats."hasUnread" = true)
    ORDER BY latest.date DESC
    LIMIT ${INBOX_PAGE_SIZE}
  `;

  return rows.map((row) => ({
    id: row.id,
    gmailThreadId: row.gmailThreadId,
    subject: row.subject,
    fromAddress: row.fromAddress,
    fromName: row.fromName,
    dateIso: row.date.toISOString(),
    labels: row.labels,
    flags: row.flags,
    snippet: row.bodyText ? row.bodyText.replace(/\s+/g, " ").trim().slice(0, 160) : null,
    bodyFetched: row.bodyFetchedAt !== null,
    messageCount: Number(row.messageCount),
    hasUnread: row.hasUnread,
  }));
}

/** Distinct-thread totals for the Inbox's All/Unread tab labels -- a thread counts as unread if any message in it is. */
export async function getInboxThreadCounts(): Promise<{ total: number; unread: number }> {
  const account = await getActiveEmailAccount();
  const rows = await prisma.$queryRaw<{ total: bigint; unread: bigint }[]>`
    SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE "hasUnread") AS unread
    FROM (
      SELECT "Message"."gmailThreadId", BOOL_OR(NOT ('\\Seen' = ANY(flags))) AS "hasUnread"
      FROM "Message"
      JOIN "Mailbox" ON "Mailbox".id = "Message"."mailboxId"
      WHERE "inInbox" = true AND "Mailbox"."accountId" = ${account.id}
      GROUP BY "Message"."gmailThreadId"
    ) t
  `;
  return { total: Number(rows[0].total), unread: Number(rows[0].unread) };
}

/**
 * A cheap "has anything changed" signal for the Inbox's own client-side
 * poll (components/InboxAutoRefresh.tsx) -- count + the newest inbox
 * message's timestamp, as one comparable string. Catches both directions:
 * new mail arriving (bumps the max date) and mail leaving the inbox via
 * archive/delete/a rule running elsewhere (changes the count). Cheap on
 * purpose (an indexed MAX + COUNT, no message bodies or joins) since this
 * runs on a short interval for as long as the Inbox page stays open.
 */
export async function getInboxFingerprint(): Promise<string> {
  const account = await getActiveEmailAccount();
  const row = await prisma.message.aggregate({
    where: { inInbox: true, mailbox: { accountId: account.id } },
    _count: { _all: true },
    _max: { date: true },
  });
  return `${row._count._all}:${row._max.date?.toISOString() ?? ""}`;
}

/**
 * Fetches (and caches) bodies for messages that don't have one yet, and
 * returns a short snippet per id. Called client-side after the Inbox list
 * mounts, not from the page's own server-rendered request -- doing up to
 * 50 sequential IMAP downloads inline would make first paint slow,
 * especially on a mailbox where nothing's been body-fetched yet. Reuses
 * the same lazy body-fetch core (`ensureMessageBody`) the AI rule-prompt
 * path already uses, so once a body's cached here, an AI rule evaluating
 * that same message later won't re-fetch it either.
 */
export async function fetchMissingSnippets(messageIds: string[]): Promise<Record<string, string | null>> {
  if (messageIds.length === 0) return {};

  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds }, bodyFetchedAt: null, mailbox: { accountId: account.id } },
    select: { id: true, uid: true, bodyText: true, bodyFetchedAt: true },
  });
  if (messages.length === 0) return {};

  const client = await connectAccountImap(account);
  const lock = await client.getMailboxLock("INBOX");

  const snippets: Record<string, string | null> = {};
  try {
    for (const message of messages) {
      try {
        const text = await ensureMessageBody(client, message);
        snippets[message.id] = text ? text.replace(/\s+/g, " ").trim().slice(0, 160) : null;
      } catch (error) {
        console.error(`Failed to fetch body for message ${message.id}:`, error);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  return snippets;
}

/**
 * Triggers `npm run sync` (incremental catch-up: creates the account's
 * Mailbox row on a genuinely first run, then only fetches UIDs newer than
 * the last one seen). Previously CLI-only, and nothing else ever ran it
 * automatically -- linking a mailbox via OAuth/IMAP never triggered a
 * sync on its own, so a freshly-linked account had no way to ever
 * populate its inbox short of someone running `npm run sync` by hand
 * inside the container. `backfill` alone can't fix this either: it needs
 * an existing Mailbox row (created by sync) to know where to start from,
 * and throws if one doesn't exist yet.
 */
export async function triggerSync(): Promise<void> {
  const account = await getActiveEmailAccount();
  await runNpmScript("sync", "sync", "/", account.id);
}

export type { BackgroundRunRow };

export async function getLatestHomeBackgroundRuns(): Promise<BackgroundRunRow[]> {
  const account = await getActiveEmailAccount();
  return getLatestBackgroundRuns(account.id, ["sync", "backfill"]);
}

/**
 * Shared across every page that renders BackgroundRunsPanel (this one,
 * /rules, /deep-clean) -- cancellation doesn't care which script kind is
 * running, just that the run belongs to the account asking to cancel it
 * (checked inside cancelBackgroundRun itself).
 */
export async function cancelRun(runId: string): Promise<void> {
  const account = await getActiveEmailAccount();
  await cancelBackgroundRun(account.id, runId);
  revalidatePath("/");
  revalidatePath("/rules");
  revalidatePath("/deep-clean");
  revalidatePath("/settings");
}

export interface MailSearchResult {
  id: string;
  gmailThreadId: string | null;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  dateIso: string;
  snippet: string | null;
}

/**
 * Real mail-content search, scoped to the active account -- distinct from
 * the command palette (which only navigates between pages). Previously
 * the only way to search message content at all was asking the chat
 * assistant (lib/ai/tools.ts's searchInbox); this is the same match logic
 * exposed directly on the Inbox.
 */
export async function searchMail(query: string): Promise<MailSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: {
      mailbox: { accountId: account.id },
      OR: [
        { fromAddress: { contains: trimmed, mode: "insensitive" } },
        { fromName: { contains: trimmed, mode: "insensitive" } },
        { subject: { contains: trimmed, mode: "insensitive" } },
      ],
    },
    orderBy: { date: "desc" },
    take: 50,
    select: { id: true, gmailThreadId: true, subject: true, fromAddress: true, fromName: true, date: true, bodyText: true },
  });

  return messages.map((m) => ({
    id: m.id,
    gmailThreadId: m.gmailThreadId,
    subject: m.subject,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    dateIso: m.date.toISOString(),
    snippet: m.bodyText ? m.bodyText.replace(/\s+/g, " ").trim().slice(0, 160) : null,
  }));
}

export interface ThreadMessageDetail {
  id: string;
  uid: number;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  subject: string | null;
  dateIso: string;
  body: string | null;
  bodyHtml: string | null;
  isUnread: boolean;
  isSentByMe: boolean;
}

/**
 * Every message in one conversation thread, oldest first, with bodies --
 * the actual "read a message" view this app didn't have before (the mail
 * list only ever showed a short snippet). Missing bodies (text and/or
 * HTML) are fetched lazily over one shared IMAP connection, same "only
 * connect if actually needed" pattern as fetchMissingSnippets. Also marks
 * any unread message in the thread as read -- both the real IMAP \Seen
 * flag (so it shows read from any other mail client too) and the local
 * mirror -- since opening a thread is exactly the "I read this" signal a
 * mail app is supposed to act on; nothing did that before this.
 */
export async function getThreadMessages(threadId: string): Promise<ThreadMessageDetail[]> {
  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: { gmailThreadId: threadId, mailbox: { accountId: account.id } },
    orderBy: { date: "asc" },
    select: {
      id: true,
      uid: true,
      fromAddress: true,
      fromName: true,
      toAddress: true,
      subject: true,
      date: true,
      bodyText: true,
      bodyHtml: true,
      bodyFetchedAt: true,
      bodyHtmlFetchedAt: true,
      flags: true,
      labels: true,
    },
  });
  if (messages.length === 0) return [];

  const bodies = new Map(messages.map((m) => [m.id, m.bodyText]));
  const htmlBodies = new Map(messages.map((m) => [m.id, m.bodyHtml]));
  const bodyMissing = messages.filter((m) => m.bodyFetchedAt === null || m.bodyHtmlFetchedAt === null);
  // Computed from the query result above, not re-read after the markRead
  // loop below -- so a message that WAS unread when this thread was
  // opened still renders as unread for this view (the highlight that
  // shows "this is the one you hadn't seen yet"), even though its
  // underlying status is now flipped to read for every other view
  // (Inbox badge, thread list, etc.) going forward.
  const unread = messages.filter((m) => !m.flags.includes("\\Seen"));

  if (bodyMissing.length > 0 || unread.length > 0) {
    const client = await connectAccountImap(account);
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const message of bodyMissing) {
        try {
          bodies.set(message.id, await ensureMessageBody(client, message));
          const fresh = await prisma.message.findUnique({ where: { id: message.id }, select: { bodyHtml: true } });
          htmlBodies.set(message.id, fresh?.bodyHtml ?? null);
        } catch (error) {
          console.error(`Failed to fetch body for message ${message.id}:`, error);
        }
      }
      for (const message of unread) {
        try {
          await applyRuleActions(client, message.uid, [{ type: "markRead" }]);
          await prisma.message.update({ where: { id: message.id }, data: { flags: { push: "\\Seen" } } });
        } catch (error) {
          console.error(`Failed to mark message ${message.id} as read:`, error);
        }
      }
    } finally {
      lock.release();
      await client.logout();
    }
    // No revalidatePath here -- this function runs as part of ThreadPage's
    // own render, and Next.js explicitly disallows calling revalidatePath
    // during a render (confirmed live: it throws "used revalidatePath
    // during render which is unsupported" and crashes the page). Not
    // needed anyway: the Inbox is force-dynamic, so navigating back to it
    // re-fetches fresh data on its own -- this only affects other
    // already-open tabs on the Inbox, which InboxAutoRefresh's poll (see
    // components/InboxAutoRefresh.tsx) will pick up on its own schedule.
  }

  return messages.map((m) => ({
    id: m.id,
    uid: m.uid,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    toAddress: m.toAddress,
    subject: m.subject,
    dateIso: m.date.toISOString(),
    body: bodies.get(m.id) ?? null,
    bodyHtml: htmlBodies.get(m.id) ?? null,
    isUnread: !m.flags.includes("\\Seen"),
    isSentByMe: m.labels.includes("\\Sent"),
  }));
}

/**
 * Replies to whichever party isn't us on the thread's latest message --
 * if that latest message is one we sent (we already replied last), reply
 * goes to its `toAddress` instead of `fromAddress` (which would just be
 * our own address). Threads via In-Reply-To/References when the target
 * message has a captured Message-ID header (see schema.prisma's comment
 * on that column) -- older synced mail without one still sends fine, it
 * just won't thread as tightly in the recipient's client.
 */
export async function replyToThread(threadId: string, body: string): Promise<{ sent: boolean }> {
  const account = await getActiveEmailAccount();
  const latest = await prisma.message.findFirst({
    where: { gmailThreadId: threadId, mailbox: { accountId: account.id } },
    orderBy: { date: "desc" },
  });
  if (!latest) throw new Error("Thread not found.");

  const isSentByMe = latest.labels.includes("\\Sent") || latest.fromAddress === account.email;
  const to = isSentByMe ? latest.toAddress : latest.fromAddress;
  if (!to) throw new Error("No recipient address found to reply to.");

  const client = await connectAccountImap(account);
  const transport = await createAccountSmtpTransport(account);
  const lock = await client.getMailboxLock("INBOX");
  try {
    await sendAndSaveToSent(transport, client, account.email, {
      to,
      subject: replySubject(latest.subject),
      text: body,
      inReplyTo: latest.messageIdHeader || undefined,
      references: latest.messageIdHeader || undefined,
    });
  } finally {
    lock.release();
    await client.logout();
  }

  revalidatePath(`/thread/${threadId}`);
  return { sent: true };
}

/** Forwards one message (with a quoted copy of its body) to a new recipient. Not threaded -- a forward starts fresh for the new recipient. */
export async function forwardMessage(messageId: string, to: string, note: string): Promise<{ sent: boolean }> {
  const account = await getActiveEmailAccount();
  const message = await prisma.message.findFirst({ where: { id: messageId, mailbox: { accountId: account.id } } });
  if (!message) throw new Error("Message not found.");

  const client = await connectAccountImap(account);
  const lock = await client.getMailboxLock("INBOX");
  try {
    const body = message.bodyText ?? (await ensureMessageBody(client, message));
    const transport = await createAccountSmtpTransport(account);
    const quoted = buildForwardBody(message, body, note);

    await sendAndSaveToSent(transport, client, account.email, {
      to,
      subject: forwardSubject(message.subject),
      text: quoted,
    });
  } finally {
    lock.release();
    await client.logout();
  }

  return { sent: true };
}
