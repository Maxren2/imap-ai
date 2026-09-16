import "./env.js";
import { connectAccountImap } from "./mail-provider.js";
import { syncOpenedMailbox, resolveBackfillSince } from "./mailbox-sync.js";
import { resolveAccounts } from "./account-scope.js";
import { prisma } from "./db.js";
import type { EmailAccount } from "./generated/prisma/index.js";

// imapflow's idle() promise only resolves on its own periodic renewal timer
// (maxIdleTime), not on individual server pushes -- an untagged EXISTS
// response fires the 'exists' event immediately while IDLE keeps running
// underneath. So the actual "new mail" trigger is the event listener below;
// the idle() loop is just a keepalive that also gives shutdown a checkpoint.
const MAX_IDLE_MS = 60_000;

async function watchAccount(account: EmailAccount, isShuttingDown: () => boolean): Promise<void> {
  const mailboxName = "INBOX";
  const client = await connectAccountImap(account, { maxIdleTime: MAX_IDLE_MS });

  try {
    const lock = await client.getMailboxLock(mailboxName);
    try {
      const initial = await syncOpenedMailbox(client, account.id, mailboxName, {
        backfillSince: resolveBackfillSince(),
      });
      console.log(
        `[${account.email}] ${mailboxName}: caught up (${initial.count} new message(s)), cursor at UID ${initial.highestUid}. Watching for new mail...`,
      );

      let syncing = false;
      let syncPending = false;
      const runSync = async () => {
        if (syncing) {
          syncPending = true;
          return;
        }
        syncing = true;
        try {
          do {
            syncPending = false;
            const { count, highestUid } = await syncOpenedMailbox(client, account.id, mailboxName);
            if (count > 0) {
              console.log(`[${account.email}] ${mailboxName}: synced ${count} new message(s), cursor now at UID ${highestUid}.`);
            }
          } while (syncPending);
        } finally {
          syncing = false;
        }
      };

      client.on("exists", () => {
        runSync().catch((error) => console.error(`[${account.email}] sync triggered by new mail failed:`, error));
      });

      while (!isShuttingDown()) {
        await client.idle();
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// One concurrent IDLE connection per linked account (or just one via
// ACCOUNT_ID/--account, see account-scope.ts) -- each account gets its own
// long-lived IMAP connection and independently reacts to new mail; one
// account's connection dropping doesn't take down anyone else's.
async function main() {
  const accounts = await resolveAccounts();
  if (accounts.length === 0) {
    console.log("No linked accounts to watch.");
    return;
  }

  let shuttingDown = false;
  const shutdown = () => {
    if (!shuttingDown) console.log("Shutting down (will stop within one IDLE cycle per account)...");
    shuttingDown = true;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const results = await Promise.allSettled(
    accounts.map((account) => watchAccount(account, () => shuttingDown)),
  );
  let anyFailed = false;
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      anyFailed = true;
      console.error(`watch failed for ${accounts[i].email}:`, result.reason);
    }
  });
  if (anyFailed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("watch failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
