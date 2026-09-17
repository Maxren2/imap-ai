import type { ImapFlow, FetchMessageObject } from "imapflow";
import { prisma } from "./db.js";
import { sleep } from "./sleep.js";
import { parseUnsubscribeHeaders } from "./unsubscribe.js";

// Header-only fetches are cheap (small responses, no body/MIME parsing),
// unlike bodies -- so unlike bodyText, these are fetched eagerly as part
// of the regular sync rather than lazily on demand.
const UNSUBSCRIBE_HEADERS = ["list-unsubscribe", "list-unsubscribe-post"];

// Only used by migrate-legacy-account.ts now -- every other account
// creation path goes through the web app's own "Connect Gmail"/"Add IMAP
// account" flows, which need a userId this function's old single-account
// callers (sync.ts/watch.ts/backfill.ts) never had. Those three now just
// loop over accounts that already exist (see account-scope.ts).
export async function ensureAccount(userId: string, email: string, provider = "gmail") {
  return prisma.emailAccount.upsert({
    where: { userId_email: { userId, email } },
    update: {},
    create: { userId, email, provider },
  });
}

/**
 * How far back a sync/backfill should reach, based on the account's own
 * syncDepthDays (a user-configurable setting, see /settings) -- 0 means
 * "all" (full history), any positive number is a day count. Used both for
 * a mailbox's first sync (as a cutoff on what gets fetched at all) and for
 * backfillOlderMessages (as the point where a depth-bounded backfill stops
 * instead of continuing all the way back to UID 1).
 */
export function resolveBackfillSince(depthDays: number): Date | undefined {
  if (!Number.isFinite(depthDays) || depthDays <= 0) return undefined;
  return new Date(Date.now() - depthDays * 24 * 60 * 60 * 1000);
}

async function upsertMessage(mailboxId: string, message: FetchMessageObject) {
  const from = message.envelope?.from?.[0];
  const to = message.envelope?.to?.[0];
  const flags = message.flags ? Array.from(message.flags) : [];
  const labels = message.labels ? Array.from(message.labels) : [];
  const unsubscribe = await parseUnsubscribeHeaders(message.headers ?? Buffer.alloc(0));

  await prisma.message.upsert({
    where: { mailboxId_uid: { mailboxId, uid: message.uid } },
    update: {
      flags,
      labels,
      listUnsubscribeUrl: unsubscribe.url,
      listUnsubscribeMailto: unsubscribe.mailto,
      listUnsubscribeOneClick: unsubscribe.oneClick,
      unsubscribeHeadersFetchedAt: new Date(),
    },
    create: {
      mailboxId,
      uid: message.uid,
      gmailThreadId: message.threadId ?? null,
      gmailMessageId: message.emailId ?? null,
      messageIdHeader: message.envelope?.messageId ?? null,
      subject: message.envelope?.subject ?? null,
      fromAddress: from?.address ?? null,
      fromName: from?.name ?? null,
      toAddress: to?.address ?? null,
      toName: to?.name ?? null,
      date: message.envelope?.date ?? new Date(),
      flags,
      labels,
      listUnsubscribeUrl: unsubscribe.url,
      listUnsubscribeMailto: unsubscribe.mailto,
      listUnsubscribeOneClick: unsubscribe.oneClick,
      unsubscribeHeadersFetchedAt: new Date(),
    },
  });
}

export interface SyncOptions {
  /**
   * Only applies to a mailbox's very first sync (no row yet). When set,
   * that first pass only fetches messages on/after this date; older mail
   * is left for a later backfillOlderMessages() call. Omit for full
   * history on the first sync, same as before this option existed.
   */
  backfillSince?: Date;
}

/**
 * Syncs the currently-opened mailbox incrementally, fetching only UIDs newer
 * than the last one seen. Assumes the caller already holds a mailbox lock
 * (via client.getMailboxLock) -- this does not open/close mailboxes itself,
 * so it's safe to call repeatedly on a long-lived IDLE connection.
 */
export async function syncOpenedMailbox(
  client: ImapFlow,
  accountId: string,
  mailboxName: string,
  options: SyncOptions = {},
): Promise<{ count: number; highestUid: number }> {
  const opened = client.mailbox;
  if (!opened || typeof opened === "boolean") {
    throw new Error(`Mailbox ${mailboxName} is not open`);
  }

  const existing = await prisma.mailbox.findUnique({
    where: { accountId_name: { accountId, name: mailboxName } },
  });

  const isFirstSync = !existing;
  const uidValidityChanged = existing && existing.uidValidity !== opened.uidValidity;
  if (uidValidityChanged) {
    console.warn(
      `UIDVALIDITY changed for ${mailboxName} (${existing.uidValidity} -> ${opened.uidValidity}); resetting sync cursor.`,
    );
  }

  const mailboxRow = await prisma.mailbox.upsert({
    where: { accountId_name: { accountId, name: mailboxName } },
    update: {
      uidValidity: opened.uidValidity,
      ...(uidValidityChanged ? { lastSeenUid: 0 } : {}),
    },
    create: { accountId, name: mailboxName, uidValidity: opened.uidValidity, lastSeenUid: 0 },
  });

  // IMAP's "n:*" range has a well-known quirk: when n exceeds the highest
  // existing UID, servers (Gmail included) still return the single
  // highest-UID message rather than an empty result, since "*" resolves to
  // that UID first. Filter anything at or below our previous cursor so a
  // quiet mailbox doesn't get re-processed on every call.
  const previousLastSeenUid = mailboxRow.lastSeenUid;
  const searchRange = previousLastSeenUid > 0 ? `${previousLastSeenUid + 1}:*` : "1:*";

  const applyBackfillWindow = isFirstSync && !!options.backfillSince;
  const searchQuery = applyBackfillWindow
    ? { uid: searchRange, since: options.backfillSince }
    : { uid: searchRange };

  let highestUid = previousLastSeenUid;
  let lowestUid: number | null = null;
  let count = 0;

  for await (const message of client.fetch(
    searchQuery,
    { uid: true, envelope: true, flags: true, internalDate: true, threadId: true, labels: true, headers: UNSUBSCRIBE_HEADERS },
  )) {
    if (message.uid <= previousLastSeenUid) continue;
    await upsertMessage(mailboxRow.id, message);
    highestUid = Math.max(highestUid, message.uid);
    lowestUid = lowestUid === null ? message.uid : Math.min(lowestUid, message.uid);
    count++;
  }

  const updateData: {
    lastSeenUid: number;
    backfillBeforeUid?: number | null;
    fullyBackfilled?: boolean;
  } = { lastSeenUid: highestUid };

  if (isFirstSync) {
    if (applyBackfillWindow) {
      const boundary = lowestUid !== null ? lowestUid - 1 : 0;
      updateData.backfillBeforeUid = boundary > 0 ? boundary : null;
      updateData.fullyBackfilled = boundary <= 0;
    } else {
      // Unbounded first sync -- there's nothing older left to backfill.
      updateData.backfillBeforeUid = null;
      updateData.fullyBackfilled = true;
    }
  }

  await prisma.mailbox.update({ where: { id: mailboxRow.id }, data: updateData });
  return { count, highestUid };
}

const BACKFILL_BATCH_SIZE = 200;
const BACKFILL_PACE_MS = 500;

/**
 * Fetches older mail left behind by a date-bounded first sync, working
 * backward in bounded batches (paced, like the bulk-run lessons this
 * project carries over -- see DESIGN.md) until fully caught up -- or,
 * when `sinceCutoff` is given, until it's backfilled as far as that date
 * (the account's configured sync depth, see resolveBackfillSince), not
 * necessarily to the beginning of the mailbox. Assumes the caller holds a
 * mailbox lock. Safe to interrupt and resume: progress is persisted after
 * every batch via backfillBeforeUid.
 */
export async function backfillOlderMessages(
  client: ImapFlow,
  accountId: string,
  mailboxName: string,
  options: {
    onProgress?: (info: { fetchedThisRun: number; remainingBeforeUid: number | null }) => void;
    maxBatches?: number;
    sinceCutoff?: Date;
  } = {},
): Promise<{ totalFetched: number; complete: boolean }> {
  let totalFetched = 0;
  let batches = 0;

  while (options.maxBatches === undefined || batches < options.maxBatches) {
    const mailboxRow = await prisma.mailbox.findUniqueOrThrow({
      where: { accountId_name: { accountId, name: mailboxName } },
    });

    if (mailboxRow.fullyBackfilled || !mailboxRow.backfillBeforeUid || mailboxRow.backfillBeforeUid <= 0) {
      if (!mailboxRow.fullyBackfilled) {
        await prisma.mailbox.update({ where: { id: mailboxRow.id }, data: { fullyBackfilled: true, backfillBeforeUid: null } });
      }
      return { totalFetched, complete: true };
    }

    const rangeEnd = mailboxRow.backfillBeforeUid;
    const rangeStart = Math.max(1, rangeEnd - BACKFILL_BATCH_SIZE + 1);
    const searchQuery = options.sinceCutoff
      ? { uid: `${rangeStart}:${rangeEnd}`, since: options.sinceCutoff }
      : { uid: `${rangeStart}:${rangeEnd}` };

    let fetchedInBatch = 0;
    for await (const message of client.fetch(
      searchQuery,
      { uid: true, envelope: true, flags: true, internalDate: true, threadId: true, labels: true, headers: UNSUBSCRIBE_HEADERS },
    )) {
      await upsertMessage(mailboxRow.id, message);
      totalFetched++;
      fetchedInBatch++;
    }
    batches++;

    const newBoundary = rangeStart - 1;
    // With a cutoff set, a batch that fetched nothing (despite the UID
    // range itself being non-empty) means every message in it is older
    // than the cutoff -- IMAP UIDs are assigned in non-decreasing order
    // as mail arrives, so once that's true, every UID further back will
    // be too. Treat that the same as reaching UID 1: stop here rather
    // than paging all the way back through mail outside the configured
    // window just to keep finding nothing.
    const reachedCutoff = options.sinceCutoff !== undefined && fetchedInBatch === 0 && newBoundary > 0;
    const nowComplete = newBoundary <= 0 || reachedCutoff;
    await prisma.mailbox.update({
      where: { id: mailboxRow.id },
      data: { backfillBeforeUid: nowComplete ? null : newBoundary, fullyBackfilled: nowComplete },
    });

    options.onProgress?.({ fetchedThisRun: totalFetched, remainingBeforeUid: nowComplete ? null : newBoundary });

    if (nowComplete) return { totalFetched, complete: true };
    await sleep(BACKFILL_PACE_MS);
  }

  return { totalFetched, complete: false };
}
