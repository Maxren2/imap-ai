import { prisma } from "../db";
import { listGoogleCalendarEvents } from "./google-calendar";
import { listMicrosoftCalendarEvents } from "./microsoft-calendar";
import type { CalendarEvent } from "./types";

const HORIZON_DAYS = 14;
const MAX_EVENTS_IN_CONTEXT = 15;

export interface CalendarEventWithSource extends CalendarEvent {
  calendarEmail: string;
}

/**
 * Fetches upcoming events across every calendar the user has connected,
 * merged and sorted. One connection failing (an expired grant, a
 * transient API error) is logged and skipped, not fatal to the rest --
 * same "don't let one bad account take down everyone else's view" pattern
 * as sync.ts/watch.ts looping over EmailAccounts.
 */
export async function listUpcomingEvents(userId: string, horizonDays = HORIZON_DAYS): Promise<CalendarEventWithSource[]> {
  const connections = await prisma.calendarConnection.findMany({ where: { userId } });
  if (connections.length === 0) return [];

  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const results = await Promise.all(
    connections.map(async (connection) => {
      try {
        const events =
          connection.provider === "google"
            ? await listGoogleCalendarEvents(connection, now, horizon)
            : await listMicrosoftCalendarEvents(connection, now, horizon);
        return events.map((event) => ({ ...event, calendarEmail: connection.email }));
      } catch (error) {
        console.error(`Failed to fetch calendar events for ${connection.email} (${connection.provider}):`, error);
        return [];
      }
    }),
  );

  return results.flat().sort((a, b) => a.start.getTime() - b.start.getTime());
}

function formatEventRange(event: CalendarEventWithSource, timezone: string | null): string {
  const zone = timezone || "UTC";
  if (event.allDay) {
    return `${event.start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })} (all day)`;
  }
  const startStr = event.start.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zone,
  });
  const endStr = event.end.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: zone });
  return `${startStr}-${endStr}`;
}

/**
 * Builds the plain-text calendar context appended to a draft/autoReply AI
 * prompt (see ai/ollama.ts's generateReplyDraft and its
 * availabilityContext field) -- the user's weekly availability window
 * plus their upcoming busy times, so the model can propose real free
 * slots instead of vague ones ("let me know what works"). Returns
 * undefined when the user has no calendars connected at all, so callers
 * can skip adding anything to the prompt rather than appending an empty
 * section.
 */
export async function buildAvailabilityContext(userId: string): Promise<string | undefined> {
  const [user, connectionCount] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.calendarConnection.count({ where: { userId } }),
  ]);
  if (!user || connectionCount === 0) return undefined;

  const events = await listUpcomingEvents(userId, HORIZON_DAYS).catch(() => []);

  const lines: string[] = [];
  if (user.availabilityTimezone) lines.push(`Timezone: ${user.availabilityTimezone}`);
  if (user.availabilityDays.length > 0 && user.availabilityStart && user.availabilityEnd) {
    lines.push(`Preferred weekly availability: ${user.availabilityDays.join(", ")} ${user.availabilityStart}-${user.availabilityEnd}`);
  }
  if (events.length > 0) {
    lines.push(`Upcoming calendar events (busy -- do not suggest these times) over the next ${HORIZON_DAYS} days:`);
    for (const event of events.slice(0, MAX_EVENTS_IN_CONTEXT)) {
      lines.push(`- ${formatEventRange(event, user.availabilityTimezone)}: ${event.summary}`);
    }
  } else {
    lines.push(`No upcoming calendar events in the next ${HORIZON_DAYS} days.`);
  }
  return lines.join("\n");
}
