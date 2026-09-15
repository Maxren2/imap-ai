import { prisma } from "@imap-ai/core/db";
import { ThreadList } from "@/components/thread-list";
import { BackgroundRunsPanel } from "@/components/BackgroundRunsPanel";
import { Button } from "@/components/ui/button";
import { triggerBackfill, getLatestHomeBackgroundRuns, getInboxThreads, getInboxThreadCounts } from "../mail-actions";
import { INBOX_PAGE_SIZE } from "@/lib/constants";
import { Download } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [account, inboxCount, threadCounts, threadMessages, inbox, backgroundRuns] = await Promise.all([
    prisma.account.findFirst(),
    prisma.message.count({ where: { inInbox: true } }),
    getInboxThreadCounts(),
    getInboxThreads(),
    prisma.mailbox.findFirst({ where: { name: "INBOX" } }),
    getLatestHomeBackgroundRuns(),
  ]);

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
        <ThreadList
          messages={threadMessages}
          totalCount={threadCounts.total}
          unreadCount={threadCounts.unread}
          pageSize={INBOX_PAGE_SIZE}
        />
      </div>
    </main>
  );
}
