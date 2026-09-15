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

## 6. Sync scope: recent-history default, full backfill on demand

- A mailbox's **first** sync only fetches messages from the last `SYNC_BACKFILL_DAYS` (default 30; `all`/`0` for full history), via IMAP's `SINCE` search combined with the UID range. Steady-state `sync`/`watch` are unaffected -- they always pick up new mail going forward regardless of this setting, since it only bounds the initial catch-up.
- `Mailbox.backfillBeforeUid` marks the boundary of what's *not* synced yet; `Mailbox.fullyBackfilled` is `true` once nothing's left. `npm run backfill` fetches everything below that boundary, working backward in paced batches (200 UIDs/batch, 500ms apart -- reusing the pacing lessons from the inbox-zero bulk-run feature) until caught up. Safe to interrupt: progress is persisted after every batch, so it resumes where it left off.
- Verified live: a 7-day-bounded first sync against an isolated test mailbox correctly set the boundary, and a capped 2-batch backfill run correctly walked further back and persisted state, matching a hand-computed expectation (not just "it didn't crash" -- exact counts and boundary values checked).
- The web app surfaces backfill status read-only (a line on the homepage when older mail is available); a toggle/button to trigger a full backfill from the UI is intentionally deferred, not yet built.

## 7. Rules engine

- `Rule.conditions` (optional): JSON array of `{field, operator, value}`, zod-validated, all AND-combined -- no OR/grouping yet. Fields: `fromAddress`, `fromName`, `subject`, `labels`. Operators: `contains`, `equals`, `startsWith` (labels always does an exact-match-against-any-label check, since Gmail labels are discrete strings, not free text).
- `Rule.aiPrompt` (optional): a natural-language condition evaluated via a local LLM (Ollama's `/api/chat`, OpenAI-style). At least one of `conditions`/`aiPrompt` must be set. When both are set, `conditions` acts as a cheap pre-filter before the AI call -- correct even without cost pressure (Ollama has no external quota), since a local LLM call is still far slower than an in-process field check.
- Metadata-only for AI matching so far (subject + sender, no body) -- message bodies aren't synced yet (see risk below), so match quality is bounded until that exists.
- `RULES_AI_MAX_PER_RUN` (default 200) caps AI evaluations per rule per run, so a rule with a large untouched backlog doesn't turn one run into a multi-hour AI sweep -- the rest is picked up next run, same idea as the sync cursor. AI calls run at limited concurrency (3) against the local Ollama server.
- `RuleMatch` records which rule matched which message, unique per (rule, message), so `npm run rules:run` is idempotent and cheap to re-run after every sync.
- **Body sync (lazy)**: `Message.bodyText`/`bodyFetchedAt` are populated on demand, the first time a rule with an AI prompt actually needs a candidate's body -- not eagerly for the whole mailbox. `packages/core/src/body.ts` downloads the raw RFC822 source over IMAP (`client.download`) and parses it with `mailparser` for the plain-text part, capped at 20,000 stored chars (3,000 of that goes into the AI prompt). `rules:run` only opens an IMAP connection at all when some enabled rule has an AI prompt and Ollama is configured -- a purely deterministic rule set never touches the network.
- Verified live against real synced mail and a real local Ollama server (`llama3:latest`): a "sender contains notifications@github.com" rule, a "has \Sent label" rule, and an AI rule ("is this a security alert about a new sign-in") all produced correct, spot-checked matches. For the AI rule specifically: out of 71 messages in this mailbox sharing the exact same subject ("Sicherheitswarnung"), body-fetch correctly ran for only the one message actually being evaluated (confirming the lazy-fetch scoping is real, not accidentally eager), the parsed body was genuine German account-alert text, and the AI still matched correctly with that added context.

## 8. Action execution

- `Rule.actions` (optional JSON array): a deliberately small subset of inbox-zero's action types (structurally inspired by `apps/web/prisma/schema.prisma`'s `ActionType` enum and `apps/web/utils/ai/actions.ts` in the inbox-zero fork, not ported) -- `label`, `archive`, `markRead`, `star`. All four are safe/reversible and non-sending; reply/forward/draft-email/delete are meaningfully more complex (composing content, guarding against destructive mistakes) and deliberately deferred.
- **Detection and action execution are separate, independently-idempotent steps** (`rules:run` vs. `rules:apply-actions`), each retriable on its own: `RuleMatch.actionsAppliedAt` (null until acted on) decouples "we detected a match" from "we changed the real mailbox." Matching is cheap and safe to run often; acting on the real mailbox is not.
- **Existing labels are respected, not duplicated**: `label` resolves an existing Gmail label by case/punctuation-insensitive name match (via IMAP LIST, since Gmail exposes labels as IMAP folders) before creating a new one, and refuses to target Gmail's reserved system labels (INBOX, SENT, IMPORTANT, the CATEGORY_* ones, etc. -- same guard list as inbox-zero's `GMAIL_RESERVED_LABELS`).
- **Gmail-specific quirk found via live testing, not documented anywhere obvious**: removing the `\Inbox` system label via IMAP's `X-GM-LABELS` STORE extension (`-X-GM-LABELS (\Inbox)`) is silently a no-op on this account -- the server responds `OK Success`, but the message stays in INBOX (confirmed by searching INBOX again afterward). The reliable mechanism is an IMAP `MOVE` to the SPECIAL-USE `\All` folder instead, which is what `archive` actually does. Because a move changes the message's UID, `archive` always runs last regardless of the order given in `Rule.actions`, so it can't invalidate the UID out from under a later action in the same call.
- Verified live end-to-end against real mailbox state (not just "the script didn't throw"): a scoped test rule (label + markRead + star + archive, targeting only known synthetic test messages) was applied, then independently re-verified with fresh IMAP searches -- the label existed and was reused correctly, `\Seen`/`\Flagged` were set, and the messages were confirmed actually gone from INBOX (not just believed to be, after the first attempt silently failed to archive and was caught this way).
- `npm run rules:seed-basic` adds a few common cleanup rules -- Newsletter, Marketing, Receipt, Notification -- structurally inspired by inbox-zero's default rule categories (`STANDARD_CATEGORY_SYSTEM_TYPES` in `apps/web/utils/rule/consts.ts`), with original (not copied) prompt wording. Seeded **disabled** by default, since they archive on match -- meant to be reviewed before turning on, not auto-applied blind.

**Deliberately not built yet**: reply/forward/draft-email/delete actions.

## 9. Web UI: rules management

- Full CRUD for rules at `/rules` (list with match/pending-action counts, `/rules/new`, `/rules/[id]/edit`), plus buttons to trigger `rules:run`/`rules:apply-actions` from the browser. Built as plain HTML forms posting to Next.js Server Actions (`apps/web/app/rules/actions.ts`) -- no client-side JS framework/state needed, works even without JS.
- The condition/action editors are intentionally simple rather than a dynamic add/remove list: 4 fixed optional condition rows (field/operator/value), and action checkboxes (archive/markRead/star) plus one label-name text input. Covers the full v1 condition/action set without needing client-side interactivity.
- The "run now" buttons spawn the exact same `npm run rules:run`/`rules:apply-actions` commands already used from the CLI, as a detached background process (`child_process.spawn(..., { detached: true, shell: true })` -- `shell: true` because a bare `npm` isn't directly executable on Windows, it's a `.cmd` shim), so the HTTP request returns immediately rather than blocking on IMAP/AI calls that can take a while. No live progress view yet -- refresh the page after a bit.
- **Build-time gotcha found and fixed**: `packages/core`'s internal relative imports used the TypeScript NodeNext convention (`"../labels.js"` resolving to `../labels.ts`), which `tsx` (the CLI runner) handles natively but neither Turbopack nor classic webpack do for a `transpilePackages`-included workspace package -- both fail with "Module not found," identically, so it's not bundler-specific. Fixed by switching `packages/core`'s `tsconfig.json` to `"moduleResolution": "bundler"` and dropping the `.js` extension from the handful of relative imports actually reachable from the web app (`rules/actions.ts` -> `../labels`, `../special-use`); confirmed the CLI scripts still run correctly under `tsx` afterward (extensionless resolution works fine there too), not just that the Next.js build succeeded.
- Verified live: full create -> list -> edit (fields correctly pre-filled) -> toggle-enabled -> delete round-trip against the real database, and the "Run detection now" button confirmed to actually spawn and complete a real background process (checked via the OS process list, not just "the button didn't error"), landing the same match counts as a manual CLI run.

**Deliberately not built yet**: an action editor beyond the fixed checkboxes/single label (no OR-conditions, no reply/forward/draft-email actions since those actions don't exist yet either), a live progress/log view for triggered runs, and a UI for the backfill-window/full-backfill feature (still CLI-only, `npm run backfill`).

## 10. Visual design: matching inbox-zero's actual UI

Goal (user request): "the same GUI visually and with almost the same features as inbox-zero" -- AI assistant chat, archive, bulk unsubscribe, etc. This is a large surface (inbox-zero's own mail client has a virtualized thread list, a streaming AI chat with tool-calling, and a real RFC 8058 one-click unsubscribe flow), so it's being built in phases rather than all at once; the user chose **visual shell first**, so every feature after this looks right from the start instead of needing a re-skin later.

- Researched inbox-zero's actual frontend stack from its real source (`C:\Users\Maxime\dev\inbox-zero`, `apps/web`), not from memory: **Tailwind CSS v3** + **shadcn/ui** (`components.json`, `style: "default"`, `baseColor: "slate"`, CSS-variable theming) on top of Radix primitives, `lucide-react` icons. The chat UI specifically uses Vercel's **AI Elements** kit (`@ai-elements/prompt-input`) over `@ai-sdk/react`'s `useChat` -- relevant when the chat phase starts.
- `apps/web` now has the same stack: Tailwind v3.4.17, shadcn `components.json` (identical config values to inbox-zero's), and the shadcn CLI's own generated `components/ui/*` primitives (button, input, checkbox, table, badge, sidebar, etc.) rather than hand-rolled equivalents -- so later features can pull in more shadcn components the same way inbox-zero does, not a divergent one-off design system.
- App shell: a collapsible sidebar (`components/app-sidebar.tsx`, using shadcn's `Sidebar`/`SidebarProvider` block) with inbox-zero's actual nav item set and icons (Inbox, Chat, Assistant, Bulk Unsubscribe, Bulk Archive, Analytics) -- items for features that don't exist yet are visibly present but disabled with a "Soon" badge, rather than omitted or dead-linked, so the target structure is visible even before each piece is built.
- Existing pages (`/`, `/rules`, `/rules/new`, `/rules/[id]/edit`) restyled onto the new system (shadcn `Table`/`Badge`/`Button`/`Input`/`Checkbox`, Tailwind utility classes) -- functionally unchanged, verified with the same create/edit/toggle/delete round-trip as before to confirm the re-skin didn't regress anything.
- Dark mode CSS variables exist (`.dark` class swap, matching shadcn's convention) but nothing toggles the class yet -- the app always renders light for now; wiring an actual theme toggle (e.g. `next-themes`) is left for later.

## 11. Risks

- Large one-time historical backfills could hit the Workspace daily bandwidth cap on very large mailboxes -- the paced, resumable `backfillOlderMessages` design (section 6) is meant to keep any single run modest regardless of total mailbox size, but a truly enormous mailbox synced in "all" mode could still take a while.
- IMAP behavior differs meaningfully across providers (Gmail extensions are Gmail-only; other providers vary in `UIDVALIDITY` stability, folder naming, etc.) — the generic-provider path needs to degrade gracefully rather than assuming Gmail semantics everywhere.
- Storing mirrored message bodies locally increases the data-security surface compared to a stateless API pass-through — encryption at rest and a clear retention/deletion policy should be part of the design, not an afterthought.
