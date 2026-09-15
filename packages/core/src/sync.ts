import "./env.js";
import { connectImap, requireEnv } from "./imap-connect.js";
import { ensureAccount, syncOpenedMailbox, resolveBackfillSince } from "./mailbox-sync.js";
import { prisma } from "./db.js";

async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);

  try {
    const account = await ensureAccount(gmailAddress);
    const mailboxName = "INBOX";

    const lock = await client.getMailboxLock(mailboxName);
    try {
      const { count, highestUid } = await syncOpenedMailbox(client, account.id, mailboxName, {
        backfillSince: resolveBackfillSince(),
      });
      console.log(`${mailboxName}: synced ${count} new message(s), cursor now at UID ${highestUid}.`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("sync failed:", error);
  process.exitCode = 1;
});
