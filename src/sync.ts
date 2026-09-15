import "dotenv/config";
import { ImapFlow } from "imapflow";
import { getGmailAccessToken } from "./gmail-oauth.js";
import { ensureAccount, syncOpenedMailbox } from "./mailbox-sync.js";
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

async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);

  try {
    const account = await ensureAccount(gmailAddress);
    const mailboxName = "INBOX";

    const lock = await client.getMailboxLock(mailboxName);
    try {
      const { count, highestUid } = await syncOpenedMailbox(client, account.id, mailboxName);
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
