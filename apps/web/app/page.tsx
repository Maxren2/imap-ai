import { prisma } from "@imap-ai/core/db";
import type { Prisma } from "@imap-ai/core/prisma";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

type RecentMessage = Prisma.MessageGetPayload<{
  select: { id: true; subject: true; fromAddress: true; fromName: true; date: true; labels: true };
}>;

export default async function HomePage() {
  const [account, messageCount, recentMessages, inbox] = await Promise.all([
    prisma.account.findFirst(),
    prisma.message.count(),
    prisma.message.findMany({
      orderBy: { date: "desc" },
      take: 20,
      select: { id: true, subject: true, fromAddress: true, fromName: true, date: true, labels: true },
    }),
    prisma.mailbox.findFirst({ where: { name: "INBOX" } }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
      {account ? (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{account.email}</span> &middot;{" "}
          {messageCount.toLocaleString()} messages mirrored
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

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Recent messages
      </h2>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Labels</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentMessages.map((message: RecentMessage) => (
              <TableRow key={message.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {message.date.toISOString().slice(0, 16).replace("T", " ")}
                </TableCell>
                <TableCell className="max-w-[180px] truncate">{message.fromName || message.fromAddress || "—"}</TableCell>
                <TableCell className="max-w-[360px] truncate">{message.subject || "(no subject)"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {message.labels
                      .filter((label) => !label.startsWith("\\"))
                      .slice(0, 3)
                      .map((label) => (
                        <Badge key={label} variant="secondary" className="font-normal">
                          {label}
                        </Badge>
                      ))}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </main>
  );
}
