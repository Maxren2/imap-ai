import "./env.js";
import { ImapFlow } from "imapflow";
import { getGmailAccessToken } from "./gmail-oauth.js";
import { ensureAccount, backfillOlderMessages } from "./mailbox-sync.js";
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
