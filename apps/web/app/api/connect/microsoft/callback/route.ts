import { NextResponse } from "next/server";
import { resolveOAuthConfig } from "@imap-ai/core/instance-config";
import { encryptSecret } from "@imap-ai/core/crypto";
import { prisma } from "@imap-ai/core/db";
import { verifyOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";
import { getRequestOrigin } from "@/lib/request-origin";
import { onAccountLinked } from "@/lib/account-linked";

// Decodes (does NOT cryptographically verify) a JWT payload. Safe here
// specifically because this id_token was never exposed to the browser --
// it arrived in the direct server-to-server response to our own POST
// (authenticated with MICROSOFT_CLIENT_SECRET) to Microsoft's token
// endpoint below, the same trust boundary Google's flow relies on via
// google-auth-library's verifyIdToken. Not safe to reuse for a token
// that came in over a redirect/query param, which google-auth-library
// exists specifically to handle.
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
    return NextResponse.redirect(new URL(`/add-account?error=${encodeURIComponent(error)}`, origin));
  }

  const stateOk = await verifyOAuthState("microsoft_oauth_state", state);
  if (!stateOk || !code) {
    return NextResponse.redirect(new URL("/add-account?error=invalid_state", origin));
  }

  const oauth = await resolveOAuthConfig();
  if (!oauth.microsoftClientId || !oauth.microsoftClientSecret) {
    return NextResponse.redirect(new URL("/add-account?error=microsoft_not_configured", origin));
  }

  // Must exactly match the redirect_uri the initial authorize request used
  // (see ../route.ts) -- Microsoft validates the two against each other
  // during the token exchange below.
  const redirectUri = new URL("/api/connect/microsoft/callback", origin).toString();

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${oauth.microsoftTenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauth.microsoftClientId,
      client_secret: oauth.microsoftClientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All",
    }),
  });

  if (!tokenResponse.ok) {
    console.error("Microsoft token exchange failed:", await tokenResponse.text());
    return NextResponse.redirect(new URL("/add-account?error=token_exchange_failed", origin));
  }

  const tokens = (await tokenResponse.json()) as { refresh_token?: string; id_token?: string };
  if (!tokens.refresh_token || !tokens.id_token) {
    return NextResponse.redirect(new URL("/add-account?error=no_refresh_token", origin));
  }

  const claims = decodeJwtPayload(tokens.id_token);
  const email = (claims.email as string | undefined) ?? (claims.preferred_username as string | undefined);
  if (!email) {
    return NextResponse.redirect(new URL("/add-account?error=no_email", origin));
  }

  const existing = await prisma.emailAccount.findUnique({ where: { userId_email: { userId: user.id, email } } });
  const account = await prisma.emailAccount.upsert({
    where: { userId_email: { userId: user.id, email } },
    update: { oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
    create: { userId: user.id, email, provider: "outlook", oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
  });

  // See the matching comment in ../../google/callback/route.ts.
  await onAccountLinked(account.id, !existing);

  return NextResponse.redirect(new URL("/", origin));
}
