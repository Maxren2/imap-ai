import "./env.js";
import { connectAccountImap } from "./mail-provider.js";
import { syncOpenedMailbox, resolveBackfillSince } from "./mailbox-sync.js";
import { resolveAccounts } from "./account-scope.js";
import { prisma } from "./db.js";

// Loops over every linked EmailAccount (or just one, via ACCOUNT_ID/
// --account -- see account-scope.ts) instead of the single env-configured
// mailbox this script used to mean. One account's failure is logged and
// skipped, not fatal to the rest -- a bad refresh token on one person's
// account shouldn't stop everyone else's sync.
async function main() {
  const accounts = await resolveAccounts();
  if (accounts.length === 0) {
    console.log("No linked accounts to sync.");
    return;
  }

  let anyFailed = false;
  for (const account of accounts) {
    const mailboxName = "INBOX";
    console.log(`Syncing ${account.email} (${account.provider})...`);
    try {
      const client = await connectAccountImap(account);
      try {
        const lock = await client.getMailboxLock(mailboxName);
        try {
          const { count, highestUid } = await syncOpenedMailbox(client, account.id, mailboxName, {
            backfillSince: resolveBackfillSince(account.syncDepthDays),
          });
          console.log(`  ${mailboxName}: synced ${count} new message(s), cursor now at UID ${highestUid}.`);
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    } catch (error) {
      anyFailed = true;
      console.error(`  sync failed for ${account.email}:`, error);
    }
  }

  if (anyFailed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("sync failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
