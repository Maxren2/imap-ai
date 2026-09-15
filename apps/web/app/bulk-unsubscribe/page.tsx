import { listSenders, countSenders } from "./actions";
import { SenderTable } from "./SenderTable";

export const dynamic = "force-dynamic";

export default async function BulkUnsubscribePage() {
  const [senders, totalCount] = await Promise.all([listSenders(), countSenders()]);
  const withUnsubscribe = senders.filter((s) => s.listUnsubscribeUrl || s.listUnsubscribeMailto).length;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Bulk Unsubscribe</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {totalCount.toLocaleString()} senders, {withUnsubscribe.toLocaleString()} with a usable unsubscribe method on
        this page. One-click uses RFC 8058 (a direct POST, no browser interaction); Link opens the sender&apos;s
        unsubscribe page for you to confirm; Email sends an actual unsubscribe request via your own account.
      </p>

      <div className="mt-6">
        <SenderTable senders={senders} totalCount={totalCount} />
      </div>
    </main>
  );
}
