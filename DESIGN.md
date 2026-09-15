# Design: an IMAP/SMTP-based AI email assistant

## 1. Problem

Provider REST APIs impose throttling that doesn't fit an AI email assistant's access pattern:

- **Gmail API**: a fixed per-user "Total Query Cost" budget per minute (not raisable via support). AI rule matching multiplies cost in a non-obvious way — a single AI-matched thread can trigger a follow-up fetch of up to 50 more messages from that sender to check pattern consistency, so concurrency has to be budgeted far below what the message-fetch cost alone would suggest.
- **Microsoft Graph**: similar throttling model, different numbers.
- Both APIs require an OAuth app registration and consent flow per provider, which is also the main barrier to self-hosted use (see "OAuth complexity" below — this doesn't go away with IMAP).

Net effect: any workload that does real background processing (bulk backfill of history, continuous rule application, AI sender-pattern analysis) is fighting the API's quota system, not just the raw volume of mail.

## 2. Why IMAP/SMTP is a different regime

IMAP and SMTP are governed by a **separate limiting system** from the REST APIs, even on the same Gmail/Outlook account:

- Gmail IMAP: capped at **~15 concurrent connections** per account, plus (on Workspace) a **daily bandwidth cap** (~2,500 MB download / 500 MB upload per day) — no per-minute request-cost throttle at all.
- This means steady-state AI processing (read new mail, evaluate rules, occasionally send) is essentially unconstrained day-to-day; the only place the daily bandwidth cap could bite is a very large one-time historical backfill (years of full message bodies) on a single account.
- **Caveat**: authenticating IMAP/SMTP against Gmail or Outlook still requires **XOAUTH2** — an OAuth2-based SASL mechanism. This does **not** eliminate the Google Cloud / Azure AD app registration and consent flow; it only changes which protocol the resulting token is used with. For generic/self-hosted IMAP servers (anything not Gmail/Outlook), plain username+app-password auth is enough, which is actually a simplification.

## 3. Prior art check

Before committing to build this, existing open-source AI email assistants were checked for whether any of them already do this for Gmail/Outlook specifically:

- **Aomail** (aomail-ai/aomail-app) advertises "connects to Gmail, Outlook, or any IMAP service," but its actual Gmail/Outlook integration (`backend/aomail/email_providers/google/*`, confirmed via source search) uses the Gmail REST API (`googleapiclient`), not IMAP. Its "any IMAP service" claim applies only to third-party/generic mail providers, not Gmail or Outlook — so it does not solve this specific problem.
- No other candidate found comes close to inbox-zero's scope (rules engine, AI drafting, digests, multi-account).

Conclusion: this is a green-field problem worth building, not a "go use X instead" situation.

## 4. Architecture

### 4.1 Ingestion (IMAP)

- One persistent **IMAP IDLE** connection per connected mailbox for near-real-time new-mail notification (the IMAP equivalent of Gmail's Pub/Sub push watch — and notably, doesn't expire/need renewal the way a Gmail watch subscription does). Verified against a real Gmail account: a message appended while idling triggered a sync within roughly 15-20 seconds -- not instant, but well within what a background assistant needs, and far better than the polling this replaces. Implementation note: the IDLE client library's "wait for activity" promise only resolves on its own periodic renewal timer, not on each individual server push -- the actual per-message trigger is an event the library emits as pushes arrive, handled separately from that promise.
- A local **mirror** of message metadata (and, lazily, bodies) in Postgres, so rule/AI evaluation reads from the local mirror instead of re-fetching from the server on every run. This is what actually kills the "hidden extra API cost per AI match" problem — sender-pattern analysis becomes a local DB query, not 50 more IMAP fetches.
- **Gmail-specific IMAP extensions** (`X-GM-LABELS`, `X-GM-THRID`, `X-GM-MSGID`) are used when talking to Gmail, to preserve label and thread semantics equivalent to what the REST API exposes today. These are Gmail-only; a generic IMAP provider falls back to plain folder/UID semantics.
- Connection budget: cap concurrent IMAP connections per account well under the ~15 limit, shared between the IDLE connection and any active sync/backfill connections.

### 4.2 Outbound (SMTP)

- Sending goes over SMTP. Unlike the REST APIs, plain SMTP does **not** automatically save a copy to Sent — the client must `APPEND` the sent message to the Sent folder itself, with correct `In-Reply-To`/`References` headers so IMAP thread linkage matches what the REST API would have produced. Verified against a real Gmail account: send + append both confirmed (delivery to INBOX, and a byte-identical copy in Sent).
- The Sent folder must be located via the **SPECIAL-USE** extension (`\Sent` flag), not a hardcoded path — confirmed necessary in testing, since a real account's Sent folder can be locale-dependent (`[Gmail]/Sent Mail` in English, `[Gmail]/Gesendet` in German, etc., not a fixed string).

### 4.3 Background processing

- Same shape as the lesson learned from inbox-zero's bulk-run feature: low concurrency per account, pacing between page fetches, bounded lookahead (prefetch depth capped at 1) so memory stays bounded regardless of mailbox size. Those constraints came from real production incidents there and carry over directly.
- Rule/AI evaluation runs against the local mirror, decoupled from the IMAP sync process — sync failures or slowdowns don't block rule processing, and vice versa.

### 4.4 Data model (sketch)

- `Account` — IMAP/SMTP host, auth method (XOAUTH2 token ref vs app-password secret ref), provider type (`gmail` | `outlook` | `generic`).
- `Mailbox` / `Folder` — server-side folder, mapped to a label for Gmail.
- `Message` — mirrored metadata + lazily-fetched body, `uid`, Gmail `thrid`/`msgid` when applicable.
- `Rule`, `Job` — carried over conceptually from inbox-zero's model; not yet decided whether to port code or reimplement.

## 5. Decisions (settled)

1. **Tech stack**: Node.js/TypeScript, `imapflow` for IMAP, `nodemailer` for SMTP, Postgres + Prisma for the local mirror. Auth, incremental sync, IDLE push, and SMTP send + Sent-folder append are all built and verified live against a real Gmail account.
2. **UI/app shape**: full web app (Next.js, matching inbox-zero's shape), not a CLI-first or lighter-service approach. Repo restructured into an npm workspace monorepo: `packages/core` (the ingest/sync/send logic above, importable, not just runnable as scripts) and `apps/web` (the Next.js app). First slice (a page listing synced messages, reading live from the shared Postgres DB) built and verified running.
3. **Code reuse**: rebuild fresh rather than port inbox-zero's rules/AI-matching code — inbox-zero's logic assumes its own API-based data model and Prisma schema, which don't match this project's local-mirror shape closely enough to be a clean port. Reference its approach conceptually where useful, but write new code against this schema.
4. **MVP scope**: single Gmail account, read + rule-match + send, no multi-account/multi-provider yet. Confirmed.

Next build step: the rules/AI-matching engine (not started), operating against the local Postgres mirror rather than live IMAP/API calls.

## 6. Risks

- Large one-time historical backfills could hit the Workspace daily bandwidth cap on very large mailboxes — needs a resumable, day-spanning backfill design (similar shape to the bulk-run job in the inbox-zero fork, but paced against bandwidth instead of quota units).
- IMAP behavior differs meaningfully across providers (Gmail extensions are Gmail-only; other providers vary in `UIDVALIDITY` stability, folder naming, etc.) — the generic-provider path needs to degrade gracefully rather than assuming Gmail semantics everywhere.
- Storing mirrored message bodies locally increases the data-security surface compared to a stateless API pass-through — encryption at rest and a clear retention/deletion policy should be part of the design, not an afterthought.
