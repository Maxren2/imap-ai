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
export async function archiveMessages(messageIds: string[]): Promise<{ archived: number }> {
  if (messageIds.length === 0) return { archived: 0 };

  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    select: { id: true, uid: true },
  });
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

export interface ThreadListMessagePlain {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  dateIso: string;
  labels: string[];
  flags: string[];
  snippet: string | null;
  bodyFetched: boolean;
}

/**
 * Keyset ("before this date") pagination for the inbox list -- used for
 * both the initial server-rendered page (no cursor) and the client-side
 * "Load more" button (cursor = the last-shown message's date). Not
 * OFFSET-based, since an ever-growing/shifting inbox makes offsets drift (a
 * new message arriving while paging shifts every later offset by one,
 * causing skipped or duplicated rows); a date cursor doesn't have that
 * problem as long as the list stays ordered by date desc, which it already
 * is.
 */
export async function getInboxMessages(beforeIso?: string): Promise<ThreadListMessagePlain[]> {
  const messages = await prisma.message.findMany({
    where: { inInbox: true, ...(beforeIso ? { date: { lt: new Date(beforeIso) } } : {}) },
    orderBy: { date: "desc" },
    take: INBOX_PAGE_SIZE,
    select: {
      id: true,
      subject: true,
      fromAddress: true,
      fromName: true,
      date: true,
      labels: true,
      flags: true,
      bodyText: true,
      bodyFetchedAt: true,
    },
  });

  return messages.map((message) => ({
    id: message.id,
    subject: message.subject,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    dateIso: message.date.toISOString(),
    labels: message.labels,
    flags: message.flags,
    snippet: message.bodyText ? message.bodyText.replace(/\s+/g, " ").trim().slice(0, 160) : null,
    bodyFetched: message.bodyFetchedAt !== null,
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
