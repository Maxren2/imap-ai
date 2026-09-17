import { decryptSecret } from "../crypto";
import { requireEnv } from "../imap-connect";
import type { CalendarConnection } from "../generated/prisma/index.js";
import type { CalendarEvent } from "./types";

interface GraphEventsResponse {
  value?: {
    subject?: string;
    isAllDay?: boolean;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  }[];
}

/**
 * Lists events on a connected Outlook/Microsoft 365 calendar between
 * `from` and `to` via Microsoft Graph's calendarview endpoint --
 * read-only (Calendars.Read scope only). Deliberately a distinct token
 * exchange from microsoft-oauth.ts's getMicrosoftAccessToken: that one's
 * refresh token was minted for real IMAP access
 * (https://outlook.office.com/IMAP.AccessAsUser.All), this one's for
 * Graph's Calendars.Read -- different scopes need different refresh
 * tokens, even against the same registered Azure AD app. This IS a real
 * Graph API call (unlike mail, which stays IMAP-only per DESIGN.md) --
 * there's no IMAP equivalent for calendar data, so this is the narrow,
 * explicit exception.
 */
export async function listMicrosoftCalendarEvents(connection: CalendarConnection, from: Date, to: Date): Promise<CalendarEvent[]> {
  const tenant = process.env.MICROSOFT_TENANT || "common";

  const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("MICROSOFT_CLIENT_ID"),
      client_secret: requireEnv("MICROSOFT_CLIENT_SECRET"),
      refresh_token: decryptSecret(connection.oauthRefreshTokenEnc),
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/Calendars.Read offline_access",
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Microsoft Calendar token refresh failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
  }
  const tokenData = (await tokenResponse.json()) as { access_token?: string };
  if (!tokenData.access_token) throw new Error("Failed to obtain a Microsoft Calendar access token from the stored refresh token.");

  const params = new URLSearchParams({
    startDateTime: from.toISOString(),
    endDateTime: to.toISOString(),
    $top: "50",
  });

  // Prefer outlook.timezone="UTC" so the returned dateTime strings are UTC
  // wall-clock values with no offset suffix -- Graph's calendarview
  // otherwise returns them in the calendar owner's own timezone, which
  // this app has no independent way to know.
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendarview?${params}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Prefer: 'outlook.timezone="UTC"' },
  });
  if (!response.ok) {
    throw new Error(`Microsoft Graph calendarview request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as GraphEventsResponse;
  return (data.value ?? [])
    .filter((item) => item.start?.dateTime && item.end?.dateTime)
    .map((item) => ({
      summary: item.subject || "(no title)",
      start: new Date(`${item.start!.dateTime}Z`),
      end: new Date(`${item.end!.dateTime}Z`),
      allDay: !!item.isAllDay,
    }));
}
