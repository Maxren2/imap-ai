import type { ImapFlow } from "imapflow";

/**
 * Finds a mailbox by its IMAP SPECIAL-USE flag (\Sent, \All, \Trash, ...)
 * rather than a guessed path -- Gmail's folder names are locale-dependent
 * (e.g. Sent is "[Gmail]/Gesendet" on a German account, All Mail is
 * "[Gmail]/Alle Nachrichten"), confirmed live on this account.
 */
export async function findSpecialUseMailbox(client: ImapFlow, specialUse: string): Promise<string | undefined> {
  const mailboxes = await client.list();
  return mailboxes.find((mailbox) => mailbox.specialUse === specialUse)?.path;
}
