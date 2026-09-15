# imap-ai

An AI email assistant that reads and sends mail over **IMAP/SMTP** instead of provider REST APIs (Gmail API, Microsoft Graph), to avoid their per-minute quota throttling on AI-heavy workloads (rule matching, sender-pattern analysis, bulk backfills).

See [DESIGN.md](DESIGN.md) for the full architecture and scoping document.

## Why

Provider REST APIs (notably Gmail's) impose a fixed per-user quota-unit budget per minute that isn't raisable via support, and AI-assisted rule matching can carry hidden extra costs (e.g. per-match sender-pattern lookups) that are easy to underbudget for. IMAP/SMTP access is governed by a different limiting system (connection count, daily bandwidth) that is far more forgiving for this kind of sustained, AI-driven mailbox processing.

## Status

Early stage, building up from the riskiest parts of the design first:

1. **IMAP auth** (`npm run imap-test`) — authenticates to Gmail over IMAP via XOAUTH2 and lists recent messages.
2. **Local mirror sync** (`npm run sync`) — incrementally syncs INBOX message metadata (envelope, flags, Gmail thread ID/labels) into a local Postgres database via Prisma, so later rule/AI evaluation reads from the DB instead of re-hitting IMAP. A mailbox's first sync only reaches back `SYNC_BACKFILL_DAYS` (default 30) by default; `npm run backfill` fetches everything older, in paced, resumable batches.
3. **Real-time watcher** (`npm run watch`) — does a catch-up sync, then holds an IMAP IDLE connection open and re-syncs whenever new mail arrives. Verified against a real Gmail account: appending a message while the watcher was idling triggered a sync within seconds.
4. **SMTP send** (`npm run smtp-test`) — sends via SMTP (XOAUTH2) and appends the same raw message to the account's Sent folder over IMAP, since plain SMTP doesn't save a sent copy. The Sent folder is located via the SPECIAL-USE extension rather than a guessed path -- confirmed necessary in testing, since this account's Sent folder is actually `[Gmail]/Gesendet` (German locale), not the commonly-assumed `[Gmail]/Sent Mail`.
5. **Web app** (`npm run dev`, then http://localhost:3000) — a Next.js app reading live from the same Postgres mirror, styled on the **same stack inbox-zero itself uses** (Tailwind CSS + shadcn/ui, confirmed from its real source, not guessed), with a collapsible sidebar matching its actual nav structure. Home is now an **interactive Inbox** — per-row and bulk-select archive (a real IMAP move, verified independently over a fresh IMAP search, not just a UI hide), unread styling, label badges, relative dates, and a trailing preview snippet per message (fetched lazily client-side after the list mounts, so a cold cache doesn't block first paint). `/rules` is a full rules manager — create/edit/delete rules (conditions, AI prompt, actions) through plain HTML forms, toggle enabled, and trigger a detection or action-execution run right from the browser (spawned as a background process, same commands as the CLI, with **live streaming output** in the page itself rather than "refresh and hope").
6. **Rules engine** (`npm run rules:run`) — evaluates enabled rules against the local mirror and records matches, idempotently. Two kinds of conditions, combinable with **AND** (default: conditions are a cheap pre-filter, the AI prompt only runs on what already passed) or **OR** (either alone is enough to match — a condition-passing message never needs an AI call at all): deterministic (AND-combined checks on fromAddress/fromName/toAddress/subject/labels) and AI (a natural-language prompt evaluated by a local Ollama model, with real body content fetched lazily and on demand). Modeled on inbox-zero's real condition system (researched from its actual source, not guessed) — its static from/to/subject/body bundle and single AND/OR toggle between that bundle and its AI instruction. `npm run rules:seed-example` creates three example rules (two deterministic, one AI) to try it against real synced mail.
7. **Action execution** (`npm run rules:apply-actions`) — applies a rule's actions (label, archive, mark read, star) to its matches, separately from detection so each step is independently safe to retry. Labels are resolved against your existing Gmail labels first (case/punctuation-insensitive), only creating a new one if nothing matches, and reserved Gmail system labels can't be targeted. `npm run rules:seed-basic` adds a few common cleanup rules (Newsletter, Marketing, Receipt, Notification), inspired by inbox-zero's default categories, seeded **disabled** so nothing auto-archives until you've reviewed what it'd catch.
8. **Bulk unsubscribe** (`/bulk-unsubscribe`) — senders grouped from your synced mail with counts, sorted by volume, filterable by status. Real RFC 8058 one-click unsubscribe (a direct POST, SSRF-guarded, no browser interaction) when a sender supports it; a manual link handed to the browser otherwise; or, for mailto-only senders, an actual unsubscribe email sent via your own SMTP. `List-Unsubscribe` headers are fetched as part of the regular sync going forward (cheap, header-only); `npm run backfill-unsubscribe-headers` is a one-time backfill for mail synced before that existed.
9. **AI assistant chat** (`/chat`) — a streaming, tool-calling chat over a local Ollama model (Vercel AI SDK + `ollama-ai-provider-v2`, the same provider inbox-zero itself uses). Can list your rules, create a new one (conditions and/or an AI prompt, with actions), search your synced mail by sender/subject, and archive a sender's inboxed mail — one persistent thread per account, history reloads on refresh. Note: not every Ollama model supports tool-calling — check `capabilities` in `GET <OLLAMA_BASE_URL>/api/tags` before picking `OLLAMA_MODEL`. The archive capability is deliberately *not* wired through the AI SDK's built-in tool-approval mechanism — that was tried first and found to be unreliable in testing (a real archive click could report success without actually running). Instead, the model only looks up a count; a real "Confirm Archive" button in the UI performs the actual mutation directly, bypassing the model entirely for that step.
10. **Bulk archive** (`/bulk-archive`) — senders ranked by how much of their mail is still sitting in your inbox, with per-sender and multi-select bulk archive (real IMAP moves, same mechanism as the Inbox page's own archive button). Unlike inbox-zero's actual Bulk Archive (which needs an AI-categorization pipeline this project doesn't have), this one is a flat sender list — modeled on this project's own Bulk Unsubscribe page instead.
11. **Analytics** (`/stats`) — mail volume over time, top senders, rule-match counts, and a sender-category breakdown (Newsletter/Marketing/Receipt/Notification/Other), all computed from the local mirror, no live Gmail calls. Categorization is a static heuristic (sender address/name/subject keywords, plus whether the sender has ever sent a `List-Unsubscribe` header) — not AI-driven like inbox-zero's real one, since classifying ~300 senders through a local Ollama model on every page load would be far too slow.
12. **No-Reply** (`/no-reply`) — threads where the last message is one you sent and nobody's replied yet. `npm run backfill-to-address` is a one-time backfill of the recipient address for sent mail synced before this feature existed (needed since a sent message's `fromAddress` is your own address, not the recipient's).
13. **Cold Email Blocker** (`/cold-email-blocker`) — detects unsolicited outreach (sales pitches, recruiting, partnership asks from strangers) using the same Rules engine, not new infrastructure: it's just a Rule (`Rule.systemType = "COLD_EMAIL"`) with no actions attached by default, so nothing auto-archives until you configure that from the Rules page yourself. "Mark Not Cold" is remembered per sender going forward. A Test tab lets you preview the AI verdict on any of your recent messages without recording it as a real match.

All thirteen verified end-to-end against a real Gmail account, a real local Postgres instance, and (for AI matching/chat) a real local Ollama server — not just typechecked, with one exception: the actual unsubscribe action (one-click POST / manual link / mailto send) was deliberately not exercised against a real vendor, at the user's request, so that specific step is unverified beyond code review. Along the way this project caught real bugs the hard way more than once:
   - `mailparser`'s undocumented handling of the entire `List-*` header family (it nests them under one `list` object, not literal header-name keys) meant the first unsubscribe-header backfill got **zero** data out of ~11,000 real messages despite typechecking fine and exiting cleanly.
   - A single (not doubled) backslash inside a `'\Sent'`/`'\Seen'` string in a raw-SQL `$queryRaw` template literal is not a valid JS escape sequence and silently cooks away to `'Sent'`/`'Seen'` (matching nothing) — found while building No-Reply, but it had already shipped in three earlier features (Bulk Archive's and Bulk Unsubscribe's "Unread" column always just equaled the total count; Analytics' sent-tracking/self-sent-exclusion were no-ops) without being caught, because the affected output still *looked* plausible.
   - Building Cold Email Blocker against this account's full ~11,000-message backlog for the first time exposed two real bugs in the shared Rules engine that had simply never been exercised before (every earlier AI rule's backlog fit in one run): concurrent IMAP body downloads on one shared connection could corrupt each other's streaming response, and a non-matching AI candidate was never marked "already checked," so a rule with a backlog bigger than its per-run AI cap could never make progress past the same newest N messages no matter how many times it was re-run. Also found, the hard way: disabling the AI model's "thinking" mode for speed measurably hurt classification accuracy on real, messy mail (HTML/CSS artifacts leaking into extracted body text) -- a batch of "detected" cold emails turned out to be a health-insurance notice, a loyalty-program promo, and newsletters, none of them actually cold outreach.
   - Making the Rules page's "Run detection now" button show live progress instead of running with output fully discarded took three failed attempts (piped stdio, a raw file descriptor, shell-native output redirection) that all produced identical symptoms — a genuinely running, successfully-exiting process with zero captured output — before finding the actual cause: an unnecessary `detached: true` on the spawn call, isolated by a standalone script that changed only that one option and went from complete output to none.

All of the above were caught by checking actual values/distributions/detected content against ground truth, not by trusting that a script exited cleanly, a chart rendered something, or a batch of "matches" looked superficially plausible. The rule-condition AND/OR combining logic added afterward was verified two ways for the same reason: the new `toAddress` field was exercised live end-to-end (a real rule, real detection run, 326 matches independently confirmed against Postgres directly), while the AND/OR branching logic itself was verified with a standalone script against the real condition-matching function and a fake AI predicate — deferred full live `OR`-mode-with-real-AI verification rather than risk a hung process against a local Ollama server that had become unresponsive again mid-phase.

Not yet built (in progress, phased -- see DESIGN.md §10-22): response-time analytics and an action-log-based archived/deleted breakdown (inbox-zero's real versions either aren't fully local-mirror-based either, or depend on an external service this project doesn't use). The mail list is also simplified for now: no thread grouping, capped at the 50 most recent (no pagination). Chat is single-thread only (no history list/rename/delete), and archive is its only mutating capability so far -- no label/send/reply from chat yet. Also still missing: reply/forward/draft-email/delete actions, a way to cancel a running background job from the UI, and a UI for triggering a full backfill (still CLI-only via `npm run backfill`). See [DESIGN.md](DESIGN.md) for the full plan.

## Structure

An npm workspace monorepo:

- `packages/core` — the IMAP/SMTP/sync logic above (`imap-test`, `sync`, `watch`, `smtp-test` all live here, runnable directly or imported).
- `apps/web` — the Next.js app.

## Getting Started

Requires Node.js 20+ and Docker (for local Postgres).

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `GMAIL_ADDRESS` — the Gmail account to connect to.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — an OAuth2 client from a Google Cloud project with Gmail access enabled.
- `GOOGLE_REFRESH_TOKEN` — a refresh token minted with the `https://mail.google.com/` scope specifically. The narrower `gmail.readonly`/`gmail.modify` scopes used by the Gmail REST API do **not** work for IMAP/SMTP — this is the one scope that grants IMAP/SMTP access. Use Google's OAuth Playground (https://developers.google.com/oauthplayground) with your own client credentials, or a short throwaway script using `google-auth-library`, to mint one against that scope.
- `DATABASE_URL` — defaults to the local Postgres instance below; no change needed for local dev.
- `SYNC_BACKFILL_DAYS` — optional, defaults to 30. `all` (or `0`) syncs full history on the first sync instead.
- `OLLAMA_BASE_URL` / `OLLAMA_MODEL` — optional, needed for AI-based rules and the assistant chat (e.g. `http://<your-ollama-host>:<port>` and a model you've pulled there). The chat feature needs a model with tool-calling support specifically — check `capabilities` in `GET <OLLAMA_BASE_URL>/api/tags`; e.g. `qwen3:8b` supports it, plain `llama3:latest` doesn't (chat will 400 with `"...does not support tools"` if you pick one that doesn't). Rules with an AI prompt are skipped with a warning if unset.

Start Postgres and apply the schema:

```bash
npm run db:up
npm run db:migrate
```

Then, either:

```bash
npm run imap-test   # connects and lists the last 10 INBOX messages, no DB involved
npm run sync         # one-shot incremental sync of INBOX metadata into Postgres
npm run watch         # catches up, then stays connected and syncs new mail as it arrives (Ctrl+C to stop)
npm run backfill       # fetches older mail left behind by a date-bounded first sync, paced and resumable
npm run smtp-test     # sends a self-addressed test email and appends it to the Sent folder
npm run dev            # starts the Next.js app at http://localhost:3000
npm run rules:seed-example  # creates three example rules (two deterministic, one AI) against the synced account
npm run rules:seed-basic    # adds a few common cleanup rules, disabled by default
npm run rules:run           # evaluates enabled rules against the local mirror
npm run rules:apply-actions # applies each rule's actions to its unactioned matches
npm run backfill-unsubscribe-headers # one-time List-Unsubscribe backfill for mail synced before it was fetched automatically
```

Both `sync` and `watch` are safe to re-run — they only fetch UIDs newer than the last one seen per mailbox, and reset the cursor automatically if the server's UIDVALIDITY changes.

All commands run from the repo root and delegate to the right workspace.
