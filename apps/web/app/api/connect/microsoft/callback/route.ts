import { NextResponse } from "next/server";
import { requireEnv } from "@imap-ai/core/imap-connect";
import { encryptSecret } from "@imap-ai/core/crypto";
import { prisma } from "@imap-ai/core/db";
import { verifyOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";

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
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/add-account?error=${encodeURIComponent(error)}`, url));
  }

  const stateOk = await verifyOAuthState("microsoft_oauth_state", state);
  if (!stateOk || !code) {
    return NextResponse.redirect(new URL("/add-account?error=invalid_state", url));
  }

  const tenant = process.env.MICROSOFT_TENANT || "common";
  const redirectUri = new URL("/api/connect/microsoft/callback", url).toString();

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requireEnv("MICROSOFT_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All",
    }),
  });

  if (!tokenResponse.ok) {
    console.error("Microsoft token exchange failed:", await tokenResponse.text());
    return NextResponse.redirect(new URL("/add-account?error=token_exchange_failed", url));
  }

  const tokens = (await tokenResponse.json()) as { refresh_token?: string; id_token?: string };
  if (!tokens.refresh_token || !tokens.id_token) {
    return NextResponse.redirect(new URL("/add-account?error=no_refresh_token", url));
  }

  const claims = decodeJwtPayload(tokens.id_token);
  const email = (claims.email as string | undefined) ?? (claims.preferred_username as string | undefined);
  if (!email) {
    return NextResponse.redirect(new URL("/add-account?error=no_email", url));
  }

  await prisma.emailAccount.upsert({
    where: { userId_email: { userId: user.id, email } },
    update: { oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
    create: { userId: user.id, email, provider: "outlook", oauthRefreshTokenEnc: encryptSecret(tokens.refresh_token) },
  });

  return NextResponse.redirect(new URL("/", url));
}
