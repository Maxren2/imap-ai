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
    return NextResponse.redirect(new URL(`/calendar?error=${encodeURIComponent(error)}`, origin));
  }

  const stateOk = await verifyOAuthState("google_calendar_oauth_state", state);
  if (!stateOk || !code) {
    return NextResponse.redirect(new URL("/calendar?error=invalid_state", origin));
  }

  // Must exactly match the redirect_uri the initial authorize request
  // used (see ../route.ts).
  const client = new OAuth2Client(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    new URL("/api/connect/google-calendar/callback", origin).toString(),
  );

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/calendar?error=no_refresh_token", origin));
  }

  client.setCredentials(tokens);
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token!, audience: requireEnv("GOOGLE_CLIENT_ID") });
  const email = ticket.getPayload()?.email;
  if (!email) {
    return NextResponse.redirect(new URL("/calendar?error=no_email", origin));
  }

  await prisma.calendarConnection.upsert({
    where: { userId_provider_email: { userId: user.id, provider: "google", email } },
    update: { oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
    create: {
      userId: user.id,
      provider: "google",
      email,
      calendarId: "primary",
      oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token),
    },
  });

  return NextResponse.redirect(new URL("/calendar", origin));
}
