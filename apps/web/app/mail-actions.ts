"use server";

import { prisma } from "@imap-ai/core/db";
import { connectImap, requireEnv } from "@imap-ai/core/imap-connect";
import { applyRuleActions } from "@imap-ai/core/rules/actions";
import { ensureMessageBody } from "@imap-ai/core/body";
import { revalidatePath } from "next/cache";
import { runNpmScript, getLatestBackgroundRuns } from "@/lib/background-run";
import type { BackgroundRunRow } from "@/lib/background-run";
import { INBOX_PAGE_SIZE } from "@/lib/constants";

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
async function archiveMessageRows(messages: { id: string; uid: number }[]): Promise<{ archived: number }> {
  if (messages.length === 0) return { archived: 0 };

  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
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
  const messages = await prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true, uid: true } });
  return archiveMessageRows(messages);
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
  const messages = await prisma.message.findMany({
    where: { gmailThreadId: { in: threadIds }, inInbox: true },
    select: { id: true, uid: true },
  });
  return archiveMessageRows(messages);
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
  const messages = await prisma.message.findMany({
    where: { fromAddress, inInbox: true },
    select: { id: true, uid: true },
  });
  if (messages.length === 0) return { labeled: 0 };

  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
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
export async function getInboxThreads(beforeIso?: string): Promise<ThreadListMessagePlain[]> {
  const cutoff = beforeIso ? new Date(beforeIso) : null;

  const rows = await prisma.$queryRaw<ThreadRowRaw[]>`
    WITH latest AS (
      SELECT DISTINCT ON ("gmailThreadId")
        id, "gmailThreadId", subject, "fromAddress", "fromName", date, labels, flags, "bodyText", "bodyFetchedAt"
      FROM "Message"
      WHERE "inInbox" = true
      ORDER BY "gmailThreadId", date DESC
    ),
    stats AS (
      SELECT "gmailThreadId", COUNT(*) AS "messageCount", BOOL_OR(NOT ('\\Seen' = ANY(flags))) AS "hasUnread"
      FROM "Message"
      WHERE "inInbox" = true
      GROUP BY "gmailThreadId"
    )
    SELECT latest.*, stats."messageCount", stats."hasUnread"
    FROM latest
    JOIN stats ON stats."gmailThreadId" = latest."gmailThreadId"
    WHERE (${cutoff}::timestamp IS NULL OR latest.date < ${cutoff}::timestamp)
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

  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds }, bodyFetchedAt: null },
    select: { id: true, uid: true, bodyText: true, bodyFetchedAt: true },
  });
  if (messages.length === 0) return {};

  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
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
 * Triggers `npm run backfill` (fetches everything the date-bounded first
 * sync left behind, working backward until fully caught up) as a tracked
 * background run -- previously CLI-only. Reuses the same mechanism /rules
 * uses for "Run detection now" (see apps/web/lib/background-run.ts).
 */
export async function triggerBackfill(): Promise<void> {
  await runNpmScript("backfill", "backfill", "/");
}

export type { BackgroundRunRow };

export async function getLatestHomeBackgroundRuns(): Promise<BackgroundRunRow[]> {
  return getLatestBackgroundRuns(["backfill"]);
}
