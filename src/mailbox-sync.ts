import type { ImapFlow, FetchMessageObject } from "imapflow";
import { prisma } from "./db.js";

export async function ensureAccount(email: string, provider = "gmail") {
  return prisma.account.upsert({
    where: { email },
    update: {},
    create: { email, provider },
  });
}

async function upsertMessage(mailboxId: string, message: FetchMessageObject) {
  const from = message.envelope?.from?.[0];
  const flags = message.flags ? Array.from(message.flags) : [];
  const labels = message.labels ? Array.from(message.labels) : [];

  await prisma.message.upsert({
    where: { mailboxId_uid: { mailboxId, uid: message.uid } },
    update: { flags, labels },
    create: {
      mailboxId,
      uid: message.uid,
      gmailThreadId: message.threadId ?? null,
      gmailMessageId: message.emailId ?? null,
      subject: message.envelope?.subject ?? null,
      fromAddress: from?.address ?? null,
      fromName: from?.name ?? null,
      date: message.envelope?.date ?? new Date(),
      flags,
      labels,
    },
  });
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
): Promise<{ count: number; highestUid: number }> {
  const opened = client.mailbox;
  if (!opened || typeof opened === "boolean") {
    throw new Error(`Mailbox ${mailboxName} is not open`);
  }

  const existing = await prisma.mailbox.findUnique({
    where: { accountId_name: { accountId, name: mailboxName } },
  });

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
  let highestUid = previousLastSeenUid;
  let count = 0;

  for await (const message of client.fetch(
    { uid: searchRange },
    { uid: true, envelope: true, flags: true, internalDate: true, threadId: true, labels: true },
  )) {
    if (message.uid <= previousLastSeenUid) continue;
    await upsertMessage(mailboxRow.id, message);
    highestUid = Math.max(highestUid, message.uid);
    count++;
  }

  await prisma.mailbox.update({ where: { id: mailboxRow.id }, data: { lastSeenUid: highestUid } });
  return { count, highestUid };
}
