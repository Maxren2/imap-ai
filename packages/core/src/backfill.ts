import "./env.js";
import { connectImap, requireEnv } from "./imap-connect.js";
import { ensureAccount, backfillOlderMessages } from "./mailbox-sync.js";
import { prisma } from "./db.js";

/**
 * Fetches everything a date-bounded first sync (SYNC_BACKFILL_DAYS) left
 * behind, working backward until fully caught up. Run this whenever you
 * want "all of it" after starting with the default recent-history window.
 */
async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const mailboxName = "INBOX";
  const client = await connectImap(gmailAddress);

  try {
    const account = await ensureAccount(gmailAddress);
    const lock = await client.getMailboxLock(mailboxName);

    try {
      const { totalFetched, complete } = await backfillOlderMessages(client, account.id, mailboxName, {
        onProgress: ({ fetchedThisRun, remainingBeforeUid }) => {
          console.log(
            `Backfilled ${fetchedThisRun} message(s) so far` +
              (remainingBeforeUid ? `, continuing below UID ${remainingBeforeUid}...` : ", done."),
          );
        },
      });
      console.log(`Backfill ${complete ? "complete" : "stopped early"}. Total fetched: ${totalFetched}.`);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("backfill failed:", error);
  process.exitCode = 1;
});
