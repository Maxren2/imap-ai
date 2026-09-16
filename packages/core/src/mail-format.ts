// Shared reply/forward formatting -- used by both the manual, user-
// composed paths (apps/web/app/mail-actions.ts's replyToThread/
// forwardMessage) and the automated rule-triggered paths (rules/
// sending-actions.ts's autoReply/autoForward actions), so the two never
// drift into producing differently-formatted output for what's
// conceptually the same operation.

export function replySubject(subject: string | null): string {
  const s = subject?.trim() || "(no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function forwardSubject(subject: string | null): string {
  const s = subject?.trim() || "(no subject)";
  return /^fwd?:/i.test(s) ? s : `Fwd: ${s}`;
}

export interface ForwardableMessage {
  fromAddress: string | null;
  fromName: string | null;
  date: Date;
  subject: string | null;
  toAddress: string | null;
}

/** Quotes the original message under a note, matching a standard "Forwarded message" header block. */
export function buildForwardBody(message: ForwardableMessage, body: string | null, note: string): string {
  return [
    note.trim(),
    "",
    "---------- Forwarded message ---------",
    `From: ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : (message.fromAddress ?? "")}`,
    `Date: ${message.date.toUTCString()}`,
    `Subject: ${message.subject ?? "(no subject)"}`,
    `To: ${message.toAddress ?? ""}`,
    "",
    body ?? "(no body)",
  ]
    .filter((line, i) => i !== 0 || line !== "")
    .join("\n");
}
