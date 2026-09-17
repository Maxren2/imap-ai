import type { ImapFlow } from "imapflow";
import { simpleParser, type Attachment } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { prisma } from "./db";

const MAX_STORED_BODY_CHARS = 20_000;
// Generous relative to plain text -- inline images are embedded as base64
// data URIs (see inlineCidImages below), which inflates size a lot for a
// handful of small logo/signature images. If sanitizing still comes out
// over this after retrying without inline images, the HTML body is
// dropped for that message entirely (falls back to plain text) rather
// than storing a truncated, likely-broken HTML/base64 fragment.
const MAX_STORED_HTML_CHARS = 500_000;

// Allowlist-based (anything not listed is stripped), same as sanitize-html's
// own default posture -- this is what actually makes rendering this HTML
// safe: <script>, on* event attributes, javascript: URLs, <iframe>,
// <object>, forms, etc. are all simply never in the allowed list, not
// individually blocked. The rendering side (EmailBody.tsx) also loads this
// through a sandboxed iframe with no allow-scripts, as defense in depth --
// sanitizing here shouldn't be the *only* thing standing between a hostile
// email and script execution.
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "b", "strong", "i", "em", "u", "s", "p", "br", "hr", "div", "span",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
    "ul", "ol", "li", "img", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "code", "font", "center", "small", "sub", "sup",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "style", "class"],
    img: ["src", "alt", "width", "height", "style", "class"],
    td: ["colspan", "rowspan", "style", "align", "valign", "bgcolor", "width", "height", "class"],
    th: ["colspan", "rowspan", "style", "align", "valign", "bgcolor", "width", "height", "class"],
    table: ["style", "align", "width", "height", "cellpadding", "cellspacing", "border", "bgcolor", "class"],
    font: ["color", "size", "face"],
    "*": ["style", "align", "class"],
  },
  allowedSchemes: ["http", "https", "mailto", "data"],
  allowedSchemesByTag: { img: ["http", "https", "data"] },
  transformTags: {
    // Every link opens in a new tab, never navigating the app itself away
    // -- rel strips window.opener access (the classic target=_blank leak)
    // and referrer leakage to whatever tracking domain the link points to.
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
  },
};

/** Replaces `cid:` image references with base64 data URIs from the message's own inline attachments, so images embedded in the email (not linked externally) actually render. */
function inlineCidImages(html: string, attachments: Attachment[]): string {
  let result = html;
  for (const attachment of attachments) {
    if (!attachment.cid || !attachment.content) continue;
    const dataUri = `data:${attachment.contentType};base64,${Buffer.from(attachment.content).toString("base64")}`;
    result = result.split(`cid:${attachment.cid}`).join(dataUri);
  }
  return result;
}

/** Drops <img> tags still pointing at an unresolved cid: reference (e.g. after skipping inlining for size) instead of leaving a broken-image icon in the rendered mail. */
function stripUnresolvedCidImages(html: string): string {
  return html.replace(/<img\b[^>]*\bsrc=["']cid:[^"']*["'][^>]*>/gi, "");
}

/**
 * Lazily fetches and stores a message's plain-text AND sanitized-HTML
 * body via IMAP, on demand -- bodies aren't synced eagerly (see
 * DESIGN.md). Idempotent per field: bodyFetchedAt/bodyHtmlFetchedAt are
 * each set even when that particular part isn't present (a text-only or
 * html-only message is a normal, successful outcome), so neither gets
 * retried forever. Assumes the caller already holds a lock on the
 * mailbox the message lives in. Returns the plain-text body only (the
 * HTML body is a side effect on the row, read separately by callers that
 * want it -- see mail-actions.ts's getThreadMessages) so this function's
 * return type/behavior is unchanged for the many callers that only ever
 * wanted plain text (AI rule matching, quoting in a forward, etc.).
 */
// Throws on a genuine fetch/parse failure -- the caller decides how to
// handle that (typically: log and skip this message for now, leaving
// bodyFetchedAt unset so it's retried on a later run).
export async function ensureMessageBody(
  client: ImapFlow,
  message: { id: string; uid: number; bodyText: string | null; bodyFetchedAt: Date | null; bodyHtmlFetchedAt?: Date | null },
): Promise<string | null> {
  if (message.bodyFetchedAt && message.bodyHtmlFetchedAt) return message.bodyText;

  const download = await client.download(String(message.uid), undefined, { uid: true });
  if (!download?.content) {
    // Seen in practice when download() is called concurrently on the same
    // connection from multiple callers -- the streaming response gets
    // corrupted and content comes back missing entirely instead of a
    // clean error. Callers must serialize IMAP access to this function per
    // connection (see rules/run.ts); this check turns that misuse into a
    // clear error instead of a cryptic "Cannot read properties of
    // undefined (reading 'Symbol(Symbol.asyncIterator)')" TypeError.
    throw new Error(`download() for message ${message.id} (uid ${message.uid}) returned no content`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of download.content) {
    chunks.push(chunk as Buffer);
  }
  const parsed = await simpleParser(Buffer.concat(chunks));
  const text = parsed.text?.trim().slice(0, MAX_STORED_BODY_CHARS) || null;

  let html: string | null = null;
  if (parsed.html) {
    const inlineAttachments = (parsed.attachments ?? []).filter((a) => a.cid);
    let sanitized = sanitizeHtml(inlineCidImages(parsed.html, inlineAttachments), SANITIZE_OPTIONS);
    if (sanitized.length > MAX_STORED_HTML_CHARS) {
      sanitized = sanitizeHtml(stripUnresolvedCidImages(parsed.html), SANITIZE_OPTIONS);
    }
    if (sanitized.length <= MAX_STORED_HTML_CHARS) html = sanitized;
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { bodyText: text, bodyFetchedAt: new Date(), bodyHtml: html, bodyHtmlFetchedAt: new Date() },
  });
  return text;
}
