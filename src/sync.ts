import "dotenv/config";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { getGmailAccessToken } from "./gmail-oauth.js";
import { prisma } from "./db.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function connectImap(gmailAddress: string): Promise<ImapFlow> {
  const accessToken = await getGmailAccessToken({
    clientId: requireEnv("GOOGLE_CLIENT_ID"),
    clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    refreshToken: requireEnv("GOOGLE_REFRESH_TOKEN"),
  });

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: gmailAddress, accessToken },
    logger: false,
  });

  await client.connect();
  return client;
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
 * Syncs one mailbox incrementally: on each run, only fetches UIDs newer
 * than the last one seen for this mailbox. A changed UIDVALIDITY means the
 * server has invalidated all previously known UIDs, so lastSeenUid resets
 * to force a full re-sync rather than silently mis-mapping stale UIDs.
 */
async function syncMailbox(client: ImapFlow, accountId: string, mailboxName: string) {
  const lock = await client.getMailboxLock(mailboxName);
  try {
    const opened = client.mailbox;
    if (!opened || typeof opened === "boolean") {
      throw new Error(`Could not open mailbox ${mailboxName}`);
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

    const searchRange = mailboxRow.lastSeenUid > 0 ? `${mailboxRow.lastSeenUid + 1}:*` : "1:*";
    let highestUid = mailboxRow.lastSeenUid;
    let count = 0;

    for await (const message of client.fetch(
      { uid: searchRange },
      { uid: true, envelope: true, flags: true, internalDate: true, threadId: true, labels: true },
    )) {
      await upsertMessage(mailboxRow.id, message);
      highestUid = Math.max(highestUid, message.uid);
      count++;
    }

    await prisma.mailbox.update({ where: { id: mailboxRow.id }, data: { lastSeenUid: highestUid } });
    console.log(`${mailboxName}: synced ${count} new message(s), cursor now at UID ${highestUid}.`);
  } finally {
    lock.release();
  }
}

async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);

  try {
    const account = await prisma.account.upsert({
      where: { email: gmailAddress },
      update: {},
      create: { email: gmailAddress, provider: "gmail" },
    });

    await syncMailbox(client, account.id, "INBOX");
  } finally {
    await client.logout();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("sync failed:", error);
  process.exitCode = 1;
});
