import type { ImapFlow } from "imapflow";

// Mirrors inbox-zero's reserved-label guard (apps/web/utils/gmail/
// label-validation.ts) -- these are Gmail system labels that can't be
// created/targeted as an arbitrary LABEL action.
const GMAIL_RESERVED_LABELS = new Set([
  "inbox", "spam", "trash", "unread", "starred", "important", "sent", "draft",
  "all mail", "allmail", "personal", "social", "promotions", "updates",
  "forums", "travel", "finance", "chat", "voicemail", "scheduled", "muted",
]);

function normalizeLabelName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function isReservedLabelName(name: string): boolean {
  return GMAIL_RESERVED_LABELS.has(normalizeLabelName(name));
}

/**
 * Finds an existing Gmail label by (normalized, case-insensitive) name and
 * reuses it, only creating a new one if nothing matches -- Gmail exposes
 * labels as IMAP mailboxes/folders, so this is the same LIST used for Sent-
 * folder discovery. Throws for a reserved system label name.
 */
export async function resolveOrCreateLabel(client: ImapFlow, labelName: string): Promise<string> {
  if (isReservedLabelName(labelName)) {
    throw new Error(`"${labelName}" is a reserved Gmail system label and can't be used as a label action target.`);
  }

  const mailboxes = await client.list();
  const existing = mailboxes.find((mailbox) => normalizeLabelName(mailbox.path) === normalizeLabelName(labelName));
  if (existing) return existing.path;

  await client.mailboxCreate(labelName);
  return labelName;
}
