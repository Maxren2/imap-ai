// Shared between the web app's sender-category heuristic
// (apps/web/lib/analytics/categorize-sender.ts) and Deep Clean's "skip
// receipts" filter (deep-clean.ts) -- lives in core so both a web
// component and a CLI script can import the exact same definition rather
// than a hand-copied regex drifting out of sync between them.
export const RECEIPT_PATTERN = /receipt|invoice|billing|\border\b|payment|purchase|confirmation/i;
