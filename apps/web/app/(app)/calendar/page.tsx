import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, CalendarClock } from "lucide-react";
import { listCalendarConnections, getUpcomingEvents } from "./actions";
import { DisconnectCalendarButton } from "./DisconnectCalendarButton";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  google_not_configured: "Google Calendar isn't set up on this instance yet -- GOOGLE_CLIENT_ID/SECRET aren't configured.",
  microsoft_not_configured: "Outlook Calendar isn't set up on this instance yet -- MICROSOFT_CLIENT_ID isn't configured.",
  invalid_state: "That connection attempt expired or was invalid. Try again.",
  no_refresh_token: "Didn't get a usable refresh token back. Try again, or revoke this app's access in your account's security settings first.",
  no_email: "Couldn't determine the calendar account's email address from the sign-in response.",
  token_exchange_failed: "The connection to the provider failed. Try again.",
};

function formatEvent(event: { startIso: string; endIso: string; allDay: boolean }): string {
  const start = new Date(event.startIso);
  const end = new Date(event.endIso);
  if (event.allDay) {
    return start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) + " (all day)";
  }
  const startStr = start.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const endStr = end.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return `${startStr} - ${endStr}`;
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [connections, events, { error }] = await Promise.all([listCalendarConnections(), getUpcomingEvents(), searchParams]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect a calendar so scheduling replies (the draft/auto-reply rule actions) can propose real free times
        instead of vague availability. Read-only -- this app never creates or modifies events. Set your weekly
        availability window on the <a href="/settings" className="underline underline-offset-4">Settings</a> page.
      </p>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {ERROR_MESSAGES[error] ?? "Something went wrong connecting that calendar."}
        </p>
      )}

      {connections.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted-foreground">Connected calendars</h2>
          <div className="mt-2 grid gap-2">
            {connections.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm">{c.email}</span>
                  <Badge variant="outline" className="font-normal capitalize">
                    {c.provider}
                  </Badge>
                </div>
                <DisconnectCalendarButton connectionId={c.id} email={c.email} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Google Calendar</CardTitle>
              <CardDescription>Read-only access, calendar.readonly scope only.</CardDescription>
            </div>
            <Button asChild>
              <a href="/api/connect/google-calendar">
                Connect <ArrowRight />
              </a>
            </Button>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Outlook Calendar</CardTitle>
              <CardDescription>Read-only access via Microsoft Graph, Calendars.Read scope only.</CardDescription>
            </div>
            <Button asChild>
              <a href="/api/connect/microsoft-calendar">
                Connect <ArrowRight />
              </a>
            </Button>
          </CardHeader>
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <CalendarClock className="h-4 w-4" /> Upcoming events (next 14 days)
        </h2>
        {connections.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Connect a calendar above to see upcoming events here.</p>
        ) : events.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing on your connected calendars in the next 14 days.</p>
        ) : (
          <div className="mt-2 grid gap-1.5">
            {events.map((event, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="truncate">{event.summary}</span>
                <span className="shrink-0 text-muted-foreground">{formatEvent(event)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
