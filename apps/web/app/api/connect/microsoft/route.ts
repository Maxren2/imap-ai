import { NextResponse } from "next/server";
import { resolveOAuthConfig } from "@imap-ai/core/instance-config";
import { createOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";
import { getRequestOrigin } from "@/lib/request-origin";

export async function GET(request: Request) {
  await requireUser();

  const origin = getRequestOrigin(request);

  // See the matching comment in api/connect/google/route.ts: a missing
  // client id is a real, expected "this provider isn't configured" case,
  // not something that should throw -- an uncaught exception here was
  // found live to corrupt Turbopack's dev-mode module cache badly enough
  // that unrelated pages broke until a restart.
  const { microsoftClientId: clientId, microsoftTenant: tenant } = await resolveOAuthConfig();
  if (!clientId) {
    return NextResponse.redirect(new URL("/add-account?error=microsoft_not_configured", origin));
  }

  const redirectUri = new URL("/api/connect/microsoft/callback", origin).toString();
  const state = await createOAuthState("microsoft_oauth_state");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    // openid+email so the callback's id_token carries this mailbox's real
    // address; offline_access for a refresh token; the IMAP scope is the
    // actual access grant (real IMAP, not Graph -- see DESIGN.md).
    scope: "openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All",
    state,
    prompt: "consent",
  });

  return NextResponse.redirect(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`);
}
