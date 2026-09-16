import "./env.js";
import { connectAccountImap } from "./mail-provider.js";
import { resolveAccounts } from "./account-scope.js";
import { prisma } from "./db.js";
import { sleep } from "./sleep.js";

const BATCH_SIZE = 300;
const PACE_MS = 300;

/**
 * One-time backfill of the RFC822 Message-ID header for messages synced
 * before it started being captured automatically (see mailbox-sync.ts) --
 * needed to reply to/forward mail synced before this existed (In-Reply-To/
 * References can't be set without it). Envelope-only fetches are cheap,
 * same reasoning as the unsubscribe-headers backfill. Loops over every
 * linked account, each over its own IMAP connection.
 */
async function backfillAccount(account: Awaited<ReturnType<typeof resolveAccounts>>[number]): Promise<void> {
  const client = await connectAccountImap(account);
  const lock = await client.getMailboxLock("INBOX");

  let totalProcessed = 0;
  try {
    while (true) {
      const batch = await prisma.message.findMany({
        where: { messageIdHeader: null, mailbox: { accountId: account.id } },
        select: { id: true, uid: true },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      const uidRange = batch.map((m) => m.uid).join(",");
      const byUid = new Map(batch.map((m) => [m.uid, m.id]));
      const seenUids = new Set<number>();

      for await (const message of client.fetch({ uid: uidRange }, { uid: true, envelope: true })) {
        const messageId = byUid.get(message.uid);
        if (!messageId) continue;
        seenUids.add(message.uid);
        await prisma.message.update({
          where: { id: messageId },
          data: { messageIdHeader: message.envelope?.messageId ?? "" },
        });
        totalProcessed++;
      }

      // A uid missing from the fetch response (deleted/moved since sync)
      // would otherwise loop forever re-selecting the same batch.
      const unseen = batch.filter((m) => !seenUids.has(m.uid)).map((m) => m.id);
      if (unseen.length > 0) {
        await prisma.message.updateMany({ where: { id: { in: unseen }, messageIdHeader: null }, data: { messageIdHeader: "" } });
      }

      console.log(`  [${account.email}] Backfilled Message-ID for ${totalProcessed} message(s) so far...`);
      await sleep(PACE_MS);
    }
  } finally {
    lock.release();
    await client.logout();
  }

  console.log(`  [${account.email}] Done. Total processed: ${totalProcessed}.`);
}

async function main() {
  const accounts = await resolveAccounts();
  if (accounts.length === 0) {
    console.log("No linked accounts.");
    return;
  }

  let anyFailed = false;
  for (const account of accounts) {
    console.log(`Backfilling Message-ID for ${account.email}...`);
    try {
      await backfillAccount(account);
    } catch (error) {
      anyFailed = true;
      console.error(`  backfill-message-id failed for ${account.email}:`, error);
    }
  }
  if (anyFailed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("backfill-message-id failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
