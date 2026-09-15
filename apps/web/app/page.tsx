import { prisma } from "@imap-ai/core/db";
import { ThreadList, type ThreadListMessage } from "@/components/thread-list";
import { BackgroundRunsPanel } from "@/components/BackgroundRunsPanel";
import { Button } from "@/components/ui/button";
import { triggerBackfill, getLatestHomeBackgroundRuns } from "./mail-actions";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [account, inboxCount, messages, inbox, backgroundRuns] = await Promise.all([
    prisma.account.findFirst(),
    prisma.message.count({ where: { inInbox: true } }),
    prisma.message.findMany({
      where: { inInbox: true },
      orderBy: { date: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        fromAddress: true,
        fromName: true,
        date: true,
        labels: true,
        flags: true,
        bodyText: true,
        bodyFetchedAt: true,
      },
    }),
    prisma.mailbox.findFirst({ where: { name: "INBOX" } }),
    getLatestHomeBackgroundRuns(),
  ]);

  const threadMessages: ThreadListMessage[] = messages.map((message) => ({
    id: message.id,
    subject: message.subject,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    dateIso: message.date.toISOString(),
    labels: message.labels,
    flags: message.flags,
    // Only messages already lazily body-fetched by something else (e.g. an
    // AI rule prompt) have a snippet for free here -- the rest are
    // fetched client-side after mount (see ThreadList), so first paint
    // isn't blocked on up to 50 IMAP downloads.
    snippet: message.bodyText ? message.bodyText.replace(/\s+/g, " ").trim().slice(0, 160) : null,
    bodyFetched: message.bodyFetchedAt !== null,
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      {account ? (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{account.email}</span> &middot;{" "}
          {inboxCount.toLocaleString()} in inbox
          {inbox && !inbox.fullyBackfilled && <> &middot; older mail not yet synced</>}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No account synced yet. Run `npm run sync` from the repo root first.</p>
      )}

      {inbox && !inbox.fullyBackfilled && (
        <form action={triggerBackfill} className="mt-3">
          <Button type="submit" size="sm" variant="outline">
            <Download /> Sync full history
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Fetches everything before your account's initial sync window, working backward until fully caught up. Runs in
            the background — safe to leave this page.
          </p>
        </form>
      )}
      <BackgroundRunsPanel initialRuns={backgroundRuns} fetchRuns={getLatestHomeBackgroundRuns} />

      <div className="mt-6">
        <ThreadList messages={threadMessages} />
      </div>
      {inboxCount > threadMessages.length && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing the {threadMessages.length} most recent of {inboxCount.toLocaleString()} in your inbox.
        </p>
      )}
    </main>
  );
}
