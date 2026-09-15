import "./env.js";
import { connectImap, requireEnv } from "./imap-connect.js";
import { createSmtpTransport, sendAndSaveToSent } from "./smtp.js";

async function main() {
  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const clientId = requireEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_CLIENT_SECRET");
  const refreshToken = requireEnv("GOOGLE_REFRESH_TOKEN");

  const transport = createSmtpTransport({ user: gmailAddress, clientId, clientSecret, refreshToken });
  const imapClient = await connectImap(gmailAddress);

  try {
    const { messageId } = await sendAndSaveToSent(transport, imapClient, gmailAddress, {
      to: gmailAddress,
      subject: "imap-ai SMTP test message",
      text: "This is a test message sent via SMTP (XOAUTH2) to verify send + Sent-folder append.",
    });
    console.log(`Sent and saved to Sent folder. Message-ID: ${messageId}`);
  } finally {
    await imapClient.logout();
  }
}

main().catch((error) => {
  console.error("smtp-test failed:", error);
  process.exitCode = 1;
});
