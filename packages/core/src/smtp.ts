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

// Exported so rules/sending-actions.ts's "draft" action can build the same
// raw MIME shape without actually sending it (a draft is an IMAP APPEND to
// the Drafts folder, no SMTP transport involved at all).
export function buildRawMessage(from: string, options: SendOptions): { raw: string; messageId: string } {
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
 *
 * Deliberately does NOT wrap the append in `imapClient.getMailboxLock()`
 * -- IMAP APPEND doesn't require (or use) a SELECTed mailbox at all (RFC
 * 3501 §6.3.11), and imapflow's lock is a strict connection-wide mutex
 * ("at most one lock may be held at a time", confirmed from its own
 * source): every caller of this function already holds a lock on a
 * DIFFERENT mailbox (INBOX) for the duration of the call, so locking Sent
 * here too would queue behind that outer lock forever, since nothing
 * releases it until this call returns -- a real deadlock, found live
 * while testing the new autoReply/autoForward rule actions (a plain
 * `append()` with no lock, exactly like saveDraft below, never hangs).
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
    await imapClient.append(sentPath, raw, ["\\Seen"]);
  } else {
    console.warn("Could not find a Sent mailbox via SPECIAL-USE; skipping Sent-folder append.");
  }

  return { messageId };
}

/**
 * Saves a message to the Drafts folder without sending it -- pure IMAP
 * APPEND, no SMTP transport involved, unlike sendAndSaveToSent above. Used
 * by the "draft" rule action (rules/sending-actions.ts): a rule can
 * propose a reply for a human to review and send themselves in their real
 * mail client, without ever composing/sending anything on its own -- the
 * non-sending counterpart to "autoReply", which uses this same
 * buildRawMessage shape but actually sends.
 */
export async function saveDraft(imapClient: ImapFlow, from: string, options: SendOptions): Promise<{ messageId: string }> {
  const { raw, messageId } = buildRawMessage(from, options);

  const draftsPath = await findSpecialUseMailbox(imapClient, "\\Drafts");
  if (!draftsPath) {
    throw new Error("Could not find the Drafts folder via SPECIAL-USE; cannot save draft.");
  }
  await imapClient.append(draftsPath, raw, ["\\Draft"]);

  return { messageId };
}
