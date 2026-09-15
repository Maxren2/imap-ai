import "./env.js";
import { connectImap, requireEnv } from "./imap-connect.js";
import { prisma } from "./db.js";
import { parseUnsubscribeHeaders } from "./unsubscribe.js";
import { sleep } from "./sleep.js";

const BATCH_SIZE = 300;
const PACE_MS = 300;
const UNSUBSCRIBE_HEADERS = ["list-unsubscribe", "list-unsubscribe-post"];

/**
 * One-time backfill of List-Unsubscribe headers for messages synced
 * before that started happening automatically (see mailbox-sync.ts).
 * Header-only fetches are cheap, so this runs in larger, faster batches
 * than the body backfill. Safe to interrupt and re-run: only processes
 * messages where unsubscribeHeadersFetchedAt is still null.
 */
async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
  const lock = await client.getMailboxLock("INBOX");

  let totalProcessed = 0;
  try {
    while (true) {
      const batch = await prisma.message.findMany({
        where: { unsubscribeHeadersFetchedAt: null },
        select: { id: true, uid: true },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      const uidRange = batch.map((m) => m.uid).join(",");
      const byUid = new Map(batch.map((m) => [m.uid, m.id]));

      for await (const message of client.fetch({ uid: uidRange }, { uid: true, headers: UNSUBSCRIBE_HEADERS })) {
        const messageId = byUid.get(message.uid);
        if (!messageId) continue;
        const unsubscribe = await parseUnsubscribeHeaders(message.headers ?? Buffer.alloc(0));
        await prisma.message.update({
          where: { id: messageId },
          data: {
            listUnsubscribeUrl: unsubscribe.url,
            listUnsubscribeMailto: unsubscribe.mailto,
            listUnsubscribeOneClick: unsubscribe.oneClick,
            unsubscribeHeadersFetchedAt: new Date(),
          },
        });
        totalProcessed++;
      }

      // A uid missing from the fetch response (deleted/moved since sync)
      // would otherwise loop forever re-selecting the same batch -- mark
      // the whole requested batch as checked regardless of which uids the
      // server actually returned.
      await prisma.message.updateMany({
        where: { id: { in: batch.map((m) => m.id) }, unsubscribeHeadersFetchedAt: null },
        data: { unsubscribeHeadersFetchedAt: new Date() },
      });

      console.log(`Backfilled unsubscribe headers for ${totalProcessed} message(s) so far...`);
      await sleep(PACE_MS);
    }
  } finally {
    lock.release();
    await client.logout();
  }

  console.log(`Done. Total processed: ${totalProcessed}.`);
}

main()
  .catch((error) => {
    console.error("backfill-unsubscribe-headers failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
