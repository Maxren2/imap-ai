import dns from "node:dns/promises";
import net from "node:net";
import { simpleParser } from "mailparser";

export interface ParsedUnsubscribeHeaders {
  url: string | null;
  mailto: string | null;
  oneClick: boolean;
}

const EMPTY: ParsedUnsubscribeHeaders = { url: null, mailto: null, oneClick: false };

interface ParsedListAddress {
  url?: string;
  mail?: string;
  name?: string;
  id?: string;
}

/**
 * Parses List-Unsubscribe/List-Unsubscribe-Post from a raw RFC822 headers
 * buffer via mailparser rather than hand-rolled regex splitting (header
 * folding/continuation is easy to get subtly wrong by hand). mailparser
 * has its own generic handling for every "List-*" header family: it
 * groups them under a single "list" header key, keyed by the part of the
 * name after "List-" (so "List-Unsubscribe" -> list.unsubscribe,
 * "List-Unsubscribe-Post" -> list["unsubscribe-post"]), and already
 * extracts the bracketed URI(s) into `.url`/`.mail` -- confirmed by
 * inspecting its parsed output directly against real mail, not just
 * reading the source, since the meaning of those fields isn't otherwise
 * documented anywhere obvious.
 */
export async function parseUnsubscribeHeaders(headersBuffer: Buffer): Promise<ParsedUnsubscribeHeaders> {
  if (headersBuffer.length === 0) return EMPTY;

  const parsed = await simpleParser(headersBuffer, { skipHtmlToText: true });
  const list = parsed.headers.get("list") as
    | { unsubscribe?: ParsedListAddress; "unsubscribe-post"?: ParsedListAddress }
    | undefined;

  if (!list?.unsubscribe) return EMPTY;

  const url = list.unsubscribe.url ?? null;
  const mailto = list.unsubscribe.mail ? `mailto:${list.unsubscribe.mail}` : null;

  const postText = list["unsubscribe-post"]?.name ?? "";
  const oneClick = !!url && /list-unsubscribe\s*=\s*one-click/i.test(postText);

  return { url, mailto, oneClick };
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
  }
  return true; // unrecognized format -- treat as unsafe rather than assume it's fine
}

/**
 * SSRF guard for POSTing to an unsubscribe URL extracted from an email
 * header -- attacker-controlled input, since anyone who can send you mail
 * can put whatever URL they want in List-Unsubscribe. Only plain http(s)
 * to a publicly-resolvable address is allowed.
 */
export async function isSafeHttpUrl(urlString: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.hostname === "localhost") return false;

  try {
    const records = await dns.lookup(url.hostname, { all: true });
    return records.every((record) => !isPrivateOrReservedIp(record.address));
  } catch {
    return false;
  }
}

const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

/**
 * Performs the actual RFC 8058 one-click unsubscribe POST. Redirects are
 * not followed automatically -- an SSRF-safe URL could redirect to an
 * unsafe one, and re-validating a redirect target isn't worth the
 * complexity here, so a redirect response is treated as "attempted, not
 * confirmed" (caller falls back to the manual link).
 */
export async function performOneClickUnsubscribe(url: string): Promise<{ ok: boolean; status: number }> {
  if (!(await isSafeHttpUrl(url))) {
    throw new Error(`Refusing to POST to unsafe unsubscribe URL: ${url}`);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: ONE_CLICK_BODY,
    redirect: "manual",
  });
  return { ok: response.status >= 200 && response.status < 300, status: response.status };
}
