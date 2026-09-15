import "./env.js";
import { connectImap, requireEnv } from "./imap-connect.js";
import { prisma } from "./db.js";
import { sleep } from "./sleep.js";

const BATCH_SIZE = 300;
const PACE_MS = 300;

/**
 * One-time backfill of the recipient (IMAP envelope "to") for sent
 * messages synced before that started happening automatically (see
 * mailbox-sync.ts) -- needed by the No-Reply feature, since `fromAddress`
 * on a sent message is our own address, not who we sent it to. Only sent
 * messages are in scope (not the whole mailbox): "\Sent" must be in
 * `labels`. Envelope-only fetches are cheap, similar to header-only ones.
 *
 * A message whose envelope genuinely has no "to" (rare, e.g. BCC-only) is
 * written as an empty string rather than left null, so `toAddress IS NULL`
 * doesn't keep re-selecting it on a future re-run -- same "mark as
 * checked regardless of outcome" idea as the unsubscribe-headers backfill,
 * just via a sentinel value instead of a separate timestamp column.
 */
async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
  const lock = await client.getMailboxLock("INBOX");

  let totalProcessed = 0;
  try {
    while (true) {
      const batch = await prisma.message.findMany({
        where: { toAddress: null, labels: { has: "\\Sent" } },
        select: { id: true, uid: true },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;

      const uidRange = batch.map((m) => m.uid).join(",");
      const byUid = new Map(batch.map((m) => [m.uid, m.id]));

      for await (const message of client.fetch({ uid: uidRange }, { uid: true, envelope: true })) {
        const messageId = byUid.get(message.uid);
        if (!messageId) continue;
        const to = message.envelope?.to?.[0];
        await prisma.message.update({
          where: { id: messageId },
          data: { toAddress: to?.address ?? "", toName: to?.name ?? null },
        });
        totalProcessed++;
      }

      // A uid missing from the fetch response (deleted/moved since sync)
      // would otherwise loop forever re-selecting the same batch.
      await prisma.message.updateMany({
        where: { id: { in: batch.map((m) => m.id) }, toAddress: null },
        data: { toAddress: "" },
      });

      console.log(`Backfilled recipient for ${totalProcessed} sent message(s) so far...`);
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
    console.error("backfill-to-address failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
