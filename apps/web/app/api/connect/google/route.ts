import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { createOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";

export async function GET(request: Request) {
  await requireUser(); // redirects to /login if not signed in

  // A missing GOOGLE_CLIENT_ID/SECRET means the operator hasn't configured
  // Gmail OAuth for this instance -- a real, expected case (not every
  // deployment wants every provider configured), not a server bug. Redirect
  // to a friendly message instead of throwing: an uncaught exception here
  // was found live to leave Turbopack's dev-mode module cache in a state
  // where unrelated pages (e.g. /login) threw "An unexpected response was
  // received from the server" until the dev server was restarted.
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/add-account?error=google_not_configured", request.url));
  }

  const client = new OAuth2Client(clientId, clientSecret, new URL("/api/connect/google/callback", request.url).toString());

  const state = await createOAuthState("google_oauth_state");

  // access_type "offline" + prompt "consent" -- without both, Google only
  // returns a refresh token on a user's *first* ever consent for this app;
  // forcing the consent screen every time guarantees one, needed since
  // this is a "connect a mailbox" grant we store long-term, not a
  // one-off sign-in.
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    // openid+email so the callback gets an id_token with this mailbox's
    // real address (see the callback's verifyIdToken use) -- mail.google.com
    // alone is the actual IMAP/SMTP access grant.
    scope: ["openid", "email", "https://mail.google.com/"],
    state,
  });

  return NextResponse.redirect(url);
}
