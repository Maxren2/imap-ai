export type SenderCategory = "Newsletter" | "Marketing" | "Receipt" | "Notification" | "Other";

export const SENDER_CATEGORIES: SenderCategory[] = ["Newsletter", "Marketing", "Receipt", "Notification", "Other"];

export interface CategorizableSender {
  fromAddress: string;
  fromName: string | null;
  lastSubject: string | null;
  hasUnsubscribe: boolean;
}

const MARKETING_PATTERN = /marketing|promo|deals?|offers?|\bsale\b|discount/i;
const RECEIPT_PATTERN = /receipt|invoice|billing|\border\b|payment|purchase|confirmation/i;
const NOTIFICATION_PATTERN = /notif|alert|no-?reply|security|support/i;

/**
 * Static heuristic pass only -- the same five-category set inbox-zero's
 * real categorize-sender pipeline uses (Newsletter/Marketing/Receipt/
 * Notification/Other; a second unimplemented tier of more specific
 * categories exists in inbox-zero's source but was never wired up, so
 * it's not reproduced here), and the same names already used by this
 * project's `rules:seed-basic`. No AI fallback for v1: running ~300
 * senders through a local Ollama model sequentially on every page load
 * would be far too slow -- inbox-zero itself only runs its AI
 * categorization as a user-triggered background batch, never inline on
 * page render, so skipping it here isn't a regression relative to it.
 *
 * `hasUnsubscribe` (a real List-Unsubscribe header seen on at least one
 * of the sender's messages) is the strongest available signal for "this
 * is a bulk sender" -- a genuine person essentially never has one.
 */
export function categorizeSender(sender: CategorizableSender): SenderCategory {
  const haystack = `${sender.fromAddress} ${sender.fromName ?? ""}`.toLowerCase();
  const subject = (sender.lastSubject ?? "").toLowerCase();

  // Keyword-specific patterns (Receipt, Notification) are checked before
  // the unsubscribe-header fallback -- a real sender can be transactional/
  // notification mail *and* carry a List-Unsubscribe header (common for
  // RFC 8058 compliance even outside marketing), so treating "has an
  // unsubscribe header" as decisive first would mis-bucket e.g.
  // notifications@github.com as a Newsletter instead of a Notification.
  if (RECEIPT_PATTERN.test(haystack) || RECEIPT_PATTERN.test(subject)) return "Receipt";
  if (NOTIFICATION_PATTERN.test(haystack)) return "Notification";

  if (sender.hasUnsubscribe) {
    if (MARKETING_PATTERN.test(haystack) || MARKETING_PATTERN.test(subject)) return "Marketing";
    return "Newsletter";
  }

  return "Other";
}
