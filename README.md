# imap-ai

An AI email assistant that reads and sends mail over **IMAP/SMTP** instead of provider REST APIs (Gmail API, Microsoft Graph), to avoid their per-minute quota throttling on AI-heavy workloads (rule matching, sender-pattern analysis, bulk backfills).

See [DESIGN.md](DESIGN.md) for the full architecture and scoping document.

## Why

Provider REST APIs (notably Gmail's) impose a fixed per-user quota-unit budget per minute that isn't raisable via support, and AI-assisted rule matching can carry hidden extra costs (e.g. per-match sender-pattern lookups) that are easy to underbudget for. IMAP/SMTP access is governed by a different limiting system (connection count, daily bandwidth) that is far more forgiving for this kind of sustained, AI-driven mailbox processing.

## Status

Early stage, building up from the riskiest parts of the design first:

1. **IMAP auth** (`npm run imap-test`) — authenticates to Gmail over IMAP via XOAUTH2 and lists recent messages.
2. **Local mirror sync** (`npm run sync`) — incrementally syncs INBOX message metadata (envelope, flags, Gmail thread ID/labels) into a local Postgres database via Prisma, so later rule/AI evaluation reads from the DB instead of re-hitting IMAP. Schema and migration verified against a real local Postgres instance.

Not yet built: IMAP IDLE (push-style sync), SMTP send, the rules/AI engine, and any UI. See [DESIGN.md](DESIGN.md) for the full plan and open decisions (tech stack, UI shape, MVP scope) still to be settled.

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

Start Postgres and apply the schema:

```bash
npm run db:up
npm run db:migrate
```

Then, either:

```bash
npm run imap-test   # connects and lists the last 10 INBOX messages, no DB involved
npm run sync         # incrementally syncs INBOX metadata into Postgres
```

`sync` is safe to re-run — it only fetches UIDs newer than the last one it saw per mailbox, and resets its cursor automatically if the server's UIDVALIDITY changes.
