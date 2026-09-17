import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { createOAuthState } from "@/lib/oauth-state";
import { requireUser } from "@/lib/session";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * Starts a Google Calendar connection -- a separate OAuth grant from
 * "Connect Gmail" (see ../google/route.ts): calendar.readonly scope only,
 * used solely to check availability when drafting scheduling replies (see
 * DESIGN.md/packages/core/src/calendar/). Reuses the same registered
 * GOOGLE_CLIENT_ID/SECRET Cloud project, just a different scope and
 * redirect URI, so it needs its own entry added to that project's
 * authorized redirect URIs.
 */
export async function GET(request: Request) {
  await requireUser(); // redirects to /login if not signed in

  const origin = getRequestOrigin(request);

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/calendar?error=google_not_configured", origin));
  }

  const client = new OAuth2Client(clientId, clientSecret, new URL("/api/connect/google-calendar/callback", origin).toString());

  const state = await createOAuthState("google_calendar_oauth_state");

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"],
    state,
  });

  return NextResponse.redirect(url);
}
