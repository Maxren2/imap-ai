import Link from "next/link";
import { prisma } from "@imap-ai/core/db";
import { ThreadList } from "@/components/thread-list";
import { MailSearch } from "@/components/mail-search";
import { BackgroundRunsPanel } from "@/components/BackgroundRunsPanel";
import { InboxAutoRefresh } from "@/components/InboxAutoRefresh";
import { Button } from "@/components/ui/button";
import {
  triggerSync,
  getLatestHomeBackgroundRuns,
  getInboxThreads,
  getInboxThreadCounts,
  getInboxFingerprint,
} from "../mail-actions";
import { INBOX_PAGE_SIZE } from "@/lib/constants";
import { RefreshCw } from "lucide-react";
import { getActiveEmailAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const account = await getActiveEmailAccount();
  const [inboxCount, threadCounts, threadMessages, inbox, backgroundRuns, fingerprint] = await Promise.all([
    prisma.message.count({ where: { inInbox: true, mailbox: { accountId: account.id } } }),
    getInboxThreadCounts(),
    getInboxThreads(),
    prisma.mailbox.findFirst({ where: { name: "INBOX", accountId: account.id } }),
    getLatestHomeBackgroundRuns(),
    getInboxFingerprint(),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <InboxAutoRefresh fingerprint={fingerprint} />
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{account.email}</span> &middot; {inboxCount.toLocaleString()} in
        inbox
        {inbox && !inbox.fullyBackfilled && <> &middot; older mail outside your configured sync depth</>}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={triggerSync}>
          <Button type="submit" size="sm" variant="outline">
            <RefreshCw /> Sync now
          </Button>
        </form>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {!inbox
          ? "Nothing synced yet -- click Sync now to fetch your mailbox for the first time."
          : "Fetches any new mail since the last sync. Runs in the background — safe to leave this page."}{" "}
        {inbox && !inbox.fullyBackfilled && (
          <>
            Change how much history to keep synced in{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Settings
            </Link>
            .
          </>
        )}
      </p>
      <BackgroundRunsPanel initialRuns={backgroundRuns} fetchRuns={getLatestHomeBackgroundRuns} />

      <div className="mt-6">
        <MailSearch />
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
