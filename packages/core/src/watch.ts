import "./env.js";
import { ImapFlow } from "imapflow";
import { getGmailAccessToken } from "./gmail-oauth.js";
import { ensureAccount, syncOpenedMailbox, resolveBackfillSince } from "./mailbox-sync.js";
import { prisma } from "./db.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// imapflow's idle() promise only resolves on its own periodic renewal timer
// (maxIdleTime), not on individual server pushes -- an untagged EXISTS
// response fires the 'exists' event immediately while IDLE keeps running
// underneath. So the actual "new mail" trigger is the event listener below;
// the idle() loop is just a keepalive that also gives shutdown a checkpoint.
const MAX_IDLE_MS = 60_000;

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
    maxIdleTime: MAX_IDLE_MS,
    logger: false,
  });

  await client.connect();
  return client;
}

async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const mailboxName = "INBOX";
  const client = await connectImap(gmailAddress);

  let shuttingDown = false;
  const shutdown = () => {
    if (!shuttingDown) console.log("Shutting down (will stop within one IDLE cycle)...");
    shuttingDown = true;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    const account = await ensureAccount(gmailAddress);
    const lock = await client.getMailboxLock(mailboxName);

    try {
      const initial = await syncOpenedMailbox(client, account.id, mailboxName, {
        backfillSince: resolveBackfillSince(),
      });
      console.log(
        `${mailboxName}: caught up (${initial.count} new message(s)), cursor at UID ${initial.highestUid}. Watching for new mail...`,
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
              console.log(`${mailboxName}: synced ${count} new message(s), cursor now at UID ${highestUid}.`);
            }
          } while (syncPending);
        } finally {
          syncing = false;
        }
      };

      client.on("exists", () => {
        runSync().catch((error) => console.error("Sync triggered by new mail failed:", error));
      });

      while (!shuttingDown) {
        await client.idle();
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("watch failed:", error);
  process.exitCode = 1;
});
