"use client";

import { useMemo, useState, useTransition } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, ExternalLink, Ban } from "lucide-react";
import { unsubscribeSender, listSenders, type SenderRow } from "./actions";
import { SENDER_PAGE_SIZE } from "@/lib/constants";

type Filter = "unhandled" | "all" | "unsubscribed";

export function SenderTable({ senders, totalCount }: { senders: SenderRow[]; totalCount: number }) {
  const [filter, setFilter] = useState<Filter>("unhandled");
  const [rows, setRows] = useState(senders);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(senders.length === SENDER_PAGE_SIZE && senders.length < totalCount);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((row) => row.status === filter);
  }, [rows, filter]);

  function handleUnsubscribe(address: string) {
    setPendingAddress(address);
    startTransition(async () => {
      const result = await unsubscribeSender(address);
      if (result.mode === "manual-link") {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
      if (result.mode !== "unavailable") {
        setRows((prev) => prev.map((row) => (row.fromAddress === address ? { ...row, status: "unsubscribed" } : row)));
      }
      setPendingAddress(null);
    });
  }

  async function loadMore() {
    if (rows.length === 0) return;
    setIsLoadingMore(true);
    try {
      const last = rows[rows.length - 1];
      const next = await listSenders({ messageCount: last.messageCount, fromAddress: last.fromAddress });
      setRows((prev) => [...prev, ...next]);
      setHasMore(next.length === SENDER_PAGE_SIZE);
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <div>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList>
          <TabsTrigger value="unhandled">Unhandled ({rows.filter((r) => r.status === "unhandled").length})</TabsTrigger>
          <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
          <TabsTrigger value="unsubscribed">
            Unsubscribed ({rows.filter((r) => r.status === "unsubscribed").length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sender</TableHead>
              <TableHead className="text-right">Emails</TableHead>
              <TableHead className="text-right">Unread</TableHead>
              <TableHead className="text-right">In inbox</TableHead>
              <TableHead>Unsubscribe</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((sender) => (
              <TableRow key={sender.fromAddress}>
                <TableCell>
                  <div className="font-medium">{sender.fromName || sender.fromAddress}</div>
                  <div className="text-xs text-muted-foreground">{sender.fromAddress}</div>
                </TableCell>
                <TableCell className="text-right">{sender.messageCount.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right">{sender.unreadCount.toLocaleString("en-US")}</TableCell>
                <TableCell className="text-right">{sender.inboxCount.toLocaleString("en-US")}</TableCell>
                <TableCell>
                  {sender.listUnsubscribeOneClick ? (
                    <Badge variant="secondary" className="font-normal">
                      <Ban className="mr-1 h-3 w-3" /> One-click
                    </Badge>
                  ) : sender.listUnsubscribeUrl ? (
                    <Badge variant="secondary" className="font-normal">
                      <ExternalLink className="mr-1 h-3 w-3" /> Link
                    </Badge>
                  ) : sender.listUnsubscribeMailto ? (
                    <Badge variant="secondary" className="font-normal">
                      <Mail className="mr-1 h-3 w-3" /> Email
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not available</span>
                  )}
                </TableCell>
                <TableCell>
                  {sender.status === "unsubscribed" ? (
                    <Badge variant="outline" className="font-normal">
                      Unsubscribed
                    </Badge>
                  ) : (
                    (sender.listUnsubscribeUrl || sender.listUnsubscribeMailto) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending && pendingAddress === sender.fromAddress}
                        onClick={() => handleUnsubscribe(sender.fromAddress)}
                      >
                        {isPending && pendingAddress === sender.fromAddress && <Loader2 className="animate-spin" />}
                        Unsubscribe
                      </Button>
                    )
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">No senders in this view.</p>
        )}
        {hasMore && (
          <div className="flex justify-center border-t px-3 py-3">
            <Button size="sm" variant="outline" disabled={isLoadingMore} onClick={loadMore}>
              {isLoadingMore && <Loader2 className="animate-spin" />}
              Load more senders
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
