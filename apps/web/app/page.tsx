import { prisma } from "@imap-ai/core/db";
import type { Prisma } from "@imap-ai/core/prisma";

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
    <main>
      <h1>Inbox</h1>
      {account ? (
        <p className="subtle">
          Account: <strong>{account.email}</strong> &middot; {messageCount.toLocaleString()} messages mirrored
          {inbox && !inbox.fullyBackfilled && (
            <>
              {" "}
              &middot; older mail not yet synced (run <code>npm run backfill</code> to fetch all of it)
            </>
          )}
        </p>
      ) : (
        <p className="subtle">No account synced yet. Run `npm run sync` from the repo root first.</p>
      )}

      <p>
        Manage matching rules and actions on <a href="/rules">the Rules page</a>.
      </p>

      <h2>Recent messages</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>From</th>
            <th>Subject</th>
            <th>Labels</th>
          </tr>
        </thead>
        <tbody>
          {recentMessages.map((message: RecentMessage) => (
            <tr key={message.id}>
              <td>{message.date.toISOString().slice(0, 16).replace("T", " ")}</td>
              <td>{message.fromName || message.fromAddress || "—"}</td>
              <td>{message.subject || "(no subject)"}</td>
              <td>{message.labels.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
