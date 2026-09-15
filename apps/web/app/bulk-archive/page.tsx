import { listArchiveCandidates } from "./actions";
import { SenderArchiveTable } from "./SenderArchiveTable";

export const dynamic = "force-dynamic";

export default async function BulkArchivePage() {
  const senders = await listArchiveCandidates();
  const totalInInbox = senders.reduce((sum, s) => sum + s.inboxCount, 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Bulk Archive</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {senders.length.toLocaleString()} senders with mail still in your inbox ({totalInInbox.toLocaleString()}{" "}
        messages total), ranked by volume. Archiving a sender moves every one of their inboxed messages to All Mail.
      </p>

      <div className="mt-6">
        <SenderArchiveTable senders={senders} />
      </div>
    </main>
  );
}
