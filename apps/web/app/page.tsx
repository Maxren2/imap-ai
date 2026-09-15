import { prisma } from "@imap-ai/core/db";
import type { Prisma } from "@imap-ai/core/prisma";

export const dynamic = "force-dynamic";

type RecentMessage = Prisma.MessageGetPayload<{
  select: { id: true; subject: true; fromAddress: true; fromName: true; date: true; labels: true };
}>;

export default async function HomePage() {
  const [account, messageCount, recentMessages] = await Promise.all([
    prisma.account.findFirst(),
    prisma.message.count(),
    prisma.message.findMany({
      orderBy: { date: "desc" },
      take: 20,
      select: { id: true, subject: true, fromAddress: true, fromName: true, date: true, labels: true },
    }),
  ]);

  return (
    <main>
      <h1>imap-ai</h1>
      {account ? (
        <p>
          Account: <strong>{account.email}</strong> &middot; {messageCount.toLocaleString()} messages mirrored
        </p>
      ) : (
        <p>No account synced yet. Run `npm run sync` from the repo root first.</p>
      )}

      <h2>Recent messages</h2>
      <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Date</th>
            <th>From</th>
            <th>Subject</th>
            <th>Labels</th>
          </tr>
        </thead>
        <tbody>
          {recentMessages.map((message: RecentMessage) => (
            <tr key={message.id} style={{ borderBottom: "1px solid #eee" }}>
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
