"use server";

import { prisma } from "@imap-ai/core/db";
import { listUpcomingEvents, type CalendarEventWithSource } from "@imap-ai/core/calendar/availability";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";

export interface CalendarConnectionRow {
  id: string;
  provider: string;
  email: string;
  createdAt: string;
}

export async function listCalendarConnections(): Promise<CalendarConnectionRow[]> {
  const user = await requireUser();
  const connections = await prisma.calendarConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return connections.map((c) => ({ id: c.id, provider: c.provider, email: c.email, createdAt: c.createdAt.toISOString() }));
}

export interface UpcomingEventRow {
  summary: string;
  startIso: string;
  endIso: string;
  allDay: boolean;
  calendarEmail: string;
}

/**
 * Fetches events live from every connected calendar on each page load --
 * no local caching/syncing of calendar data the way mail is synced, since
 * this is only ever used to read a short look-ahead window, not build a
 * local mirror. One connection's API call failing is swallowed inside
 * listUpcomingEvents itself (see its own comment), so this never partially
 * fails the page.
 */
export async function getUpcomingEvents(): Promise<UpcomingEventRow[]> {
  const user = await requireUser();
  const events: CalendarEventWithSource[] = await listUpcomingEvents(user.id);
  return events.map((event) => ({
    summary: event.summary,
    startIso: event.start.toISOString(),
    endIso: event.end.toISOString(),
    allDay: event.allDay,
    calendarEmail: event.calendarEmail,
  }));
}

export async function disconnectCalendar(connectionId: string): Promise<void> {
  const user = await requireUser();
  await prisma.calendarConnection.deleteMany({ where: { id: connectionId, userId: user.id } });
  revalidatePath("/calendar");
}
