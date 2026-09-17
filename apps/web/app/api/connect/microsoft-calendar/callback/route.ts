import { NextResponse } from "next/server";
import { resolveOAuthConfig } from "@imap-ai/core/instance-config";
import { encryptSecret } from "@imap-ai/core/crypto";
import { prisma } from "@imap-ai/core/db";
import { verifyOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";
import { getRequestOrigin } from "@/lib/request-origin";

// Decodes (does NOT cryptographically verify) a JWT payload -- see the
// identical comment in ../../microsoft/callback/route.ts for why that's
// safe here: this id_token arrived in our own direct, authenticated POST
// to Microsoft's token endpoint below, never exposed to the browser.
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

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

  const stateOk = await verifyOAuthState("microsoft_calendar_oauth_state", state);
  if (!stateOk || !code) {
    return NextResponse.redirect(new URL("/calendar?error=invalid_state", origin));
  }

  const oauth = await resolveOAuthConfig();
  if (!oauth.microsoftClientId || !oauth.microsoftClientSecret) {
    return NextResponse.redirect(new URL("/calendar?error=microsoft_not_configured", origin));
  }

  // Must exactly match the redirect_uri the initial authorize request
  // used (see ../route.ts).
  const redirectUri = new URL("/api/connect/microsoft-calendar/callback", origin).toString();

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${oauth.microsoftTenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.microsoftClientId,
      client_secret: oauth.microsoftClientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "openid email offline_access https://graph.microsoft.com/Calendars.Read",
    }),
  });

  if (!tokenResponse.ok) {
    console.error("Microsoft Calendar token exchange failed:", await tokenResponse.text());
    return NextResponse.redirect(new URL("/calendar?error=token_exchange_failed", origin));
  }

  const tokens = (await tokenResponse.json()) as { refresh_token?: string; id_token?: string };
  if (!tokens.refresh_token || !tokens.id_token) {
    return NextResponse.redirect(new URL("/calendar?error=no_refresh_token", origin));
  }

  const claims = decodeJwtPayload(tokens.id_token);
  const email = (claims.email as string | undefined) ?? (claims.preferred_username as string | undefined);
  if (!email) {
    return NextResponse.redirect(new URL("/calendar?error=no_email", origin));
  }

  await prisma.calendarConnection.upsert({
    where: { userId_provider_email: { userId: user.id, provider: "microsoft", email } },
    update: { oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
    create: {
      userId: user.id,
      provider: "microsoft",
      email,
      calendarId: "primary",
      oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token),
    },
  });

  return NextResponse.redirect(new URL("/calendar", origin));
}
