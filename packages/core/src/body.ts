import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "./db";

const MAX_STORED_BODY_CHARS = 20_000;

/**
 * Lazily fetches and stores a message's plain-text body via IMAP, on
 * demand -- bodies aren't synced eagerly (see DESIGN.md). Idempotent:
 * returns the stored value without hitting IMAP again once fetched, even
 * if the fetch found no text part (bodyFetchedAt is set either way, so a
 * body-less message -- e.g. an image-only email -- doesn't get retried
 * forever). Assumes the caller already holds a lock on the mailbox the
 * message lives in.
 */
// Throws on a genuine fetch/parse failure -- the caller decides how to
// handle that (typically: log and skip this message for now, leaving
// bodyFetchedAt unset so it's retried on a later run). A message that
// downloads fine but simply has no text part is a *successful* outcome
// (bodyText null, bodyFetchedAt set), not an error.
export async function ensureMessageBody(
  client: ImapFlow,
  message: { id: string; uid: number; bodyText: string | null; bodyFetchedAt: Date | null },
): Promise<string | null> {
  if (message.bodyFetchedAt) return message.bodyText;

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

  await prisma.message.update({ where: { id: message.id }, data: { bodyText: text, bodyFetchedAt: new Date() } });
  return text;
}
