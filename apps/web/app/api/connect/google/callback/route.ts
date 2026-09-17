import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { requireEnv } from "@imap-ai/core/imap-connect";
import { encryptSecret } from "@imap-ai/core/crypto";
import { prisma } from "@imap-ai/core/db";
import { verifyOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";
import { getRequestOrigin } from "@/lib/request-origin";

export async function GET(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/add-account?error=${encodeURIComponent(error)}`, origin));
  }

  const stateOk = await verifyOAuthState("google_oauth_state", state);
  if (!stateOk || !code) {
    return NextResponse.redirect(new URL("/add-account?error=invalid_state", origin));
  }

  // Must exactly match the redirect_uri the initial authorize request
  // used (see ../route.ts) -- Google validates the two against each
  // other during the token exchange below, not just against what's
  // registered in Google Cloud Console.
  const client = new OAuth2Client(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    new URL("/api/connect/google/callback", origin).toString(),
  );

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    // Happens if the user has already granted this app consent before AND
    // Google didn't re-issue a refresh token despite prompt=consent (rare,
    // but possible if access was revoked oddly) -- nothing usable to store.
    return NextResponse.redirect(new URL("/add-account?error=no_refresh_token", origin));
  }

  // Need the actual mailbox address, not just a token -- fetched from
  // Google's tokeninfo endpoint via the id_token Google also returns
  // alongside the access/refresh tokens for this scope request.
  client.setCredentials(tokens);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: requireEnv("GOOGLE_CLIENT_ID") });
  const email = ticket.getPayload()?.email;
  if (!email) {
    return NextResponse.redirect(new URL("/add-account?error=no_email", origin));
  }

  await prisma.emailAccount.upsert({
    where: { userId_email: { userId: user.id, email } },
    update: { oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
    create: { userId: user.id, email, provider: "gmail", oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
  });

  return NextResponse.redirect(new URL("/", origin));
}
