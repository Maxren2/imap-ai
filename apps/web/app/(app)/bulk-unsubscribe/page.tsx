import { listSenders, countSenders } from "./actions";
import { SenderTable } from "./SenderTable";

export const dynamic = "force-dynamic";

export default async function BulkUnsubscribePage() {
  const [senders, totalCount] = await Promise.all([listSenders(), countSenders()]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Bulk Unsubscribe</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {totalCount.toLocaleString()} sender{totalCount === 1 ? "" : "s"} with a usable unsubscribe method. Senders
        with no unsubscribe link, mailto, or one-click header aren&apos;t shown here -- there&apos;s nothing this page
        can act on for them. One-click uses RFC 8058 (a direct POST, no browser interaction); Link opens the
        sender&apos;s unsubscribe page for you to confirm; Email sends an actual unsubscribe request via your own
        account.
      </p>

      <div className="mt-6">
        <SenderTable senders={senders} totalCount={totalCount} />
      </div>
    </main>
  );
}
