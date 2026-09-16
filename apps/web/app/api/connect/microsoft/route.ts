import { NextResponse } from "next/server";
import { requireEnv } from "@imap-ai/core/imap-connect";
import { createOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";

export async function GET(request: Request) {
  await requireUser();

  const tenant = process.env.MICROSOFT_TENANT || "common";
  const redirectUri = new URL("/api/connect/microsoft/callback", request.url).toString();
  const state = await createOAuthState("microsoft_oauth_state");

  const params = new URLSearchParams({
    client_id: requireEnv("MICROSOFT_CLIENT_ID"),
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
