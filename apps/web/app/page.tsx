import { prisma } from "@imap-ai/core/db";
import type { Prisma } from "@imap-ai/core/prisma";

export const dynamic = "force-dynamic";

type RecentMessage = Prisma.MessageGetPayload<{
  select: { id: true; subject: true; fromAddress: true; fromName: true; date: true; labels: true };
}>;

export default async function HomePage() {
  const [account, messageCount, recentMessages, rules] = await Promise.all([
    prisma.account.findFirst(),
    prisma.message.count(),
    prisma.message.findMany({
      orderBy: { date: "desc" },
      take: 20,
      select: { id: true, subject: true, fromAddress: true, fromName: true, date: true, labels: true },
    }),
    prisma.rule.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { matches: true } } },
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

      <h2>Rules</h2>
      {rules.length === 0 ? (
        <p>No rules yet. Run `npm run rules:seed-example` for a couple of examples, then `npm run rules:run`.</p>
      ) : (
        <table cellPadding={6} style={{ borderCollapse: "collapse", width: "100%", marginBottom: "1.5rem" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Name</th>
              <th>Enabled</th>
              <th>Matches</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} style={{ borderBottom: "1px solid #eee" }}>
                <td>{rule.name}</td>
                <td>{rule.enabled ? "yes" : "no"}</td>
                <td>{rule._count.matches.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
