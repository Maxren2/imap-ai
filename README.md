# imap-ai

An AI email assistant that reads and sends mail over **IMAP/SMTP** instead of provider REST APIs (Gmail API, Microsoft Graph), to avoid their per-minute quota throttling on AI-heavy workloads (rule matching, sender-pattern analysis, bulk backfills).

See [DESIGN.md](DESIGN.md) for the full architecture and scoping document.

## Why

Provider REST APIs (notably Gmail's) impose a fixed per-user quota-unit budget per minute that isn't raisable via support, and AI-assisted rule matching can carry hidden extra costs (e.g. per-match sender-pattern lookups) that are easy to underbudget for. IMAP/SMTP access is governed by a different limiting system (connection count, daily bandwidth) that is far more forgiving for this kind of sustained, AI-driven mailbox processing.

## Status

Early stage. First working slice: a standalone script that authenticates to Gmail over IMAP via XOAUTH2 and lists recent messages — proving out the riskiest, most novel part of the design before building the sync/DB/rules layers on top. See [DESIGN.md](DESIGN.md) for the full plan and open decisions (tech stack, UI shape, MVP scope) still to be settled.

## Getting Started

Requires Node.js 20+.

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

- `GMAIL_ADDRESS` — the Gmail account to connect to.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — an OAuth2 client from a Google Cloud project with Gmail access enabled.
- `GOOGLE_REFRESH_TOKEN` — a refresh token minted with the `https://mail.google.com/` scope specifically. The narrower `gmail.readonly`/`gmail.modify` scopes used by the Gmail REST API do **not** work for IMAP/SMTP — this is the one scope that grants IMAP/SMTP access. Use Google's OAuth Playground (https://developers.google.com/oauthplayground) with your own client credentials, or a short throwaway script using `google-auth-library`, to mint one against that scope.

Then:

```bash
npm run imap-test
```

This connects to `imap.gmail.com` over IMAP using XOAUTH2, opens INBOX, and prints the last 10 messages' date/sender/subject.
