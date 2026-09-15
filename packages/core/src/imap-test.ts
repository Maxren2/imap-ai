import "./env.js";
import { connectImap, requireEnv } from "./imap-connect.js";

async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
  console.log(`Connected to ${gmailAddress} over IMAP.`);

  const lock = await client.getMailboxLock("INBOX");
  try {
    const mailbox = client.mailbox;
    if (!mailbox || typeof mailbox === "boolean") {
      throw new Error("Could not open INBOX");
    }
    console.log(`INBOX has ${mailbox.exists} messages.`);

    const from = Math.max(1, mailbox.exists - 9);
    const range = `${from}:${mailbox.exists}`;

    for await (const message of client.fetch(range, { envelope: true, flags: true })) {
      const from = message.envelope?.from?.[0];
      console.log(
        `#${message.seq}  ${message.envelope?.date?.toISOString() ?? "?"}  ` +
          `${from?.name || from?.address || "unknown"}  -  ${message.envelope?.subject ?? "(no subject)"}`,
      );
    }
  } finally {
    lock.release();
  }

  await client.logout();
}

main().catch((error) => {
  console.error("imap-test failed:", error);
  process.exitCode = 1;
});
