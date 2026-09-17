import { OAuth2Client } from "google-auth-library";
import { decryptSecret } from "../crypto";
import { requireEnv } from "../imap-connect";
import type { CalendarConnection } from "../generated/prisma/index.js";
import type { CalendarEvent } from "./types";

interface GoogleEventsResponse {
  items?: {
    summary?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }[];
}

/**
 * Lists events on a connected Google Calendar between `from` and `to` --
 * read-only (this connection's refresh token was only ever granted the
 * calendar.readonly scope, see CalendarConnection's schema comment), used
 * solely to compute busy times for scheduling replies. Never creates or
 * modifies events. Mirrors gmail-oauth.ts's access-token exchange, but
 * kept local here rather than shared -- this is a distinct grant (a
 * different refresh token, a different scope) from the mail account's own
 * OAuth credentials, even though it reuses the same registered Google
 * Cloud OAuth client id/secret.
 */
export async function listGoogleCalendarEvents(connection: CalendarConnection, from: Date, to: Date): Promise<CalendarEvent[]> {
  const client = new OAuth2Client(requireEnv("GOOGLE_CLIENT_ID"), requireEnv("GOOGLE_CLIENT_SECRET"));
  client.setCredentials({ refresh_token: decryptSecret(connection.oauthRefreshTokenEnc) });

  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Failed to obtain a Google Calendar access token from the stored refresh token.");

  const params = new URLSearchParams({
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Google Calendar events request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as GoogleEventsResponse;
  return (data.items ?? [])
    .filter((item) => item.start && item.end)
    .map((item) => ({
      summary: item.summary || "(no title)",
      // An all-day event has `date` (no time), not `dateTime`.
      start: new Date(item.start!.dateTime ?? item.start!.date!),
      end: new Date(item.end!.dateTime ?? item.end!.date!),
      allDay: !item.start!.dateTime,
    }));
}
