import "./env.js";
import { connectAccountImap } from "./mail-provider.js";
import { backfillOlderMessages } from "./mailbox-sync.js";
import { resolveAccounts } from "./account-scope.js";
import { prisma } from "./db.js";

/**
 * Fetches everything a date-bounded first sync (SYNC_BACKFILL_DAYS) left
 * behind, working backward until fully caught up. Loops over every linked
 * account (or just one via ACCOUNT_ID/--account, see account-scope.ts) --
 * the web UI's "Sync full history" button passes the account it was
 * clicked from.
 */
async function main() {
  const accounts = await resolveAccounts();
  if (accounts.length === 0) {
    console.log("No linked accounts to backfill.");
    return;
  }

  let anyFailed = false;
  for (const account of accounts) {
    const mailboxName = "INBOX";
    console.log(`Backfilling ${account.email} (${account.provider})...`);
    try {
      const client = await connectAccountImap(account);
      try {
        const lock = await client.getMailboxLock(mailboxName);
        try {
          const { totalFetched, complete } = await backfillOlderMessages(client, account.id, mailboxName, {
            onProgress: ({ fetchedThisRun, remainingBeforeUid }) => {
              console.log(
                `  Backfilled ${fetchedThisRun} message(s) so far` +
                  (remainingBeforeUid ? `, continuing below UID ${remainingBeforeUid}...` : ", done."),
              );
            },
          });
          console.log(`  Backfill ${complete ? "complete" : "stopped early"}. Total fetched: ${totalFetched}.`);
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    } catch (error) {
      anyFailed = true;
      console.error(`  backfill failed for ${account.email}:`, error);
    }
  }

  if (anyFailed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
