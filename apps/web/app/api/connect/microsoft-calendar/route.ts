import { NextResponse } from "next/server";
import { createOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * Starts an Outlook/Microsoft 365 Calendar connection -- a separate OAuth
 * grant from "Connect Outlook" (see ../microsoft/route.ts): Graph's
 * Calendars.Read scope only, used solely for availability-checking (see
 * packages/core/src/calendar/). Reuses the same registered
 * MICROSOFT_CLIENT_ID/SECRET Azure AD app, so it needs Calendars.Read
 * added to that app's API permissions and its own redirect URI added.
 */
export async function GET(request: Request) {
  await requireUser();

  const origin = getRequestOrigin(request);

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/calendar?error=microsoft_not_configured", origin));
  }

  const tenant = process.env.MICROSOFT_TENANT || "common";
  const redirectUri = new URL("/api/connect/microsoft-calendar/callback", origin).toString();
  const state = await createOAuthState("microsoft_calendar_oauth_state");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid email offline_access https://graph.microsoft.com/Calendars.Read",
    state,
    prompt: "consent",
  });

  return NextResponse.redirect(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`);
}
