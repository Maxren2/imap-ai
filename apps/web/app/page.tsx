import { prisma } from "@imap-ai/core/db";
import { ThreadList, type ThreadListMessage } from "@/components/thread-list";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [account, inboxCount, messages, inbox] = await Promise.all([
    prisma.account.findFirst(),
    prisma.message.count({ where: { inInbox: true } }),
    prisma.message.findMany({
      where: { inInbox: true },
      orderBy: { date: "desc" },
      take: 50,
      select: { id: true, subject: true, fromAddress: true, fromName: true, date: true, labels: true, flags: true },
    }),
    prisma.mailbox.findFirst({ where: { name: "INBOX" } }),
  ]);

  const threadMessages: ThreadListMessage[] = messages.map((message) => ({
    id: message.id,
    subject: message.subject,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    dateIso: message.date.toISOString(),
    labels: message.labels,
    flags: message.flags,
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      {account ? (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{account.email}</span> &middot;{" "}
          {inboxCount.toLocaleString()} in inbox
          {inbox && !inbox.fullyBackfilled && (
            <>
              {" "}
              &middot; older mail not yet synced (run <code className="rounded bg-muted px-1 py-0.5">npm run backfill</code>)
            </>
          )}
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">No account synced yet. Run `npm run sync` from the repo root first.</p>
      )}

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
