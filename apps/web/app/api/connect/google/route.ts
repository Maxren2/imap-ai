import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { requireEnv } from "@imap-ai/core/imap-connect";
import { createOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";

export async function GET(request: Request) {
  await requireUser(); // redirects to /login if not signed in

  const client = new OAuth2Client(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    new URL("/api/connect/google/callback", request.url).toString(),
  );

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
