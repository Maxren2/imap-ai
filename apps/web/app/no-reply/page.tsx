import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getNoReplyThreads } from "./queries";

export const dynamic = "force-dynamic";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function NoReplyPage() {
  const threads = await getNoReplyThreads();

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">No-Reply</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {threads.length.toLocaleString()} threads where the last message is one you sent -- nobody's replied (yet).
        If a recipient shows blank, run <code className="rounded bg-muted px-1 py-0.5">npm run backfill-to-address</code>{" "}
        to fill in recipients for mail synced before this page existed.
      </p>

      <div className="mt-6 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>To</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead className="text-right">Sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {threads.map((thread) => (
              <TableRow key={thread.id}>
                <TableCell>
                  <div className="font-medium">{thread.toName || thread.toAddress || "Unknown"}</div>
                  {thread.toName && thread.toAddress && (
                    <div className="text-xs text-muted-foreground">{thread.toAddress}</div>
                  )}
                </TableCell>
                <TableCell className="max-w-sm truncate text-sm">{thread.subject || "(no subject)"}</TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">{formatDate(thread.dateIso)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {threads.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            Nothing here -- every thread you've sent mail in has a reply.
          </p>
        )}
      </div>
    </main>
  );
}
