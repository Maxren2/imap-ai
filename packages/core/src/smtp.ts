import nodemailer, { type Transporter } from "nodemailer";
import type { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { findSpecialUseMailbox } from "./special-use";

export interface SmtpOAuthEnv {
  user: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function createSmtpTransport(env: SmtpOAuthEnv) {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      type: "OAuth2",
      user: env.user,
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      refreshToken: env.refreshToken,
    },
  });
}

export interface SendOptions {
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}

function buildRawMessage(from: string, options: SendOptions): { raw: string; messageId: string } {
  const messageId = `<${randomUUID()}@imap-ai>`;
  const headers = [
    `From: ${from}`,
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...(options.inReplyTo ? [`In-Reply-To: ${options.inReplyTo}`] : []),
    ...(options.references ? [`References: ${options.references}`] : []),
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
  ];
  const raw = `${headers.join("\r\n")}\r\n\r\n${options.text}`;
  return { raw, messageId };
}

/**
 * Sends a message over SMTP and appends the exact same raw MIME source to
 * the account's Sent folder over IMAP -- plain SMTP doesn't save a sent
 * copy the way the Gmail REST API does, so the client has to do it itself.
 */
export async function sendAndSaveToSent(
  transport: Transporter,
  imapClient: ImapFlow,
  from: string,
  options: SendOptions,
) {
  const { raw, messageId } = buildRawMessage(from, options);

  // With `raw`, nodemailer sends the message verbatim and does NOT parse
  // headers to build the SMTP envelope -- it must be given explicitly.
  await transport.sendMail({ raw, envelope: { from, to: options.to } });

  const sentPath = await findSpecialUseMailbox(imapClient, "\\Sent");
  if (sentPath) {
    const lock = await imapClient.getMailboxLock(sentPath);
    try {
      await imapClient.append(sentPath, raw, ["\\Seen"]);
    } finally {
      lock.release();
    }
  } else {
    console.warn("Could not find a Sent mailbox via SPECIAL-USE; skipping Sent-folder append.");
  }

  return { messageId };
}
