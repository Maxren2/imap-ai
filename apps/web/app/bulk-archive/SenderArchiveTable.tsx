"use client";

import { useMemo, useState, useTransition } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Archive, Loader2 } from "lucide-react";
import { archiveSenders, listArchiveCandidates, type ArchiveCandidateRow } from "./actions";
import { SENDER_PAGE_SIZE } from "@/lib/constants";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function SenderArchiveTable({ senders, totalCount }: { senders: ArchiveCandidateRow[]; totalCount: number }) {
  const [rows, setRows] = useState(senders);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(senders.length === SENDER_PAGE_SIZE && senders.length < totalCount);

  async function loadMore() {
    if (rows.length === 0) return;
    setIsLoadingMore(true);
    try {
      const last = rows[rows.length - 1];
      const next = await listArchiveCandidates({ inboxCount: last.inboxCount, fromAddress: last.fromAddress });
      setRows((prev) => [...prev, ...next]);
      setHasMore(next.length === SENDER_PAGE_SIZE);
    } finally {
      setIsLoadingMore(false);
    }
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.fromAddress)));
  }

  function toggleOne(address: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  }

  function archive(addresses: string[]) {
    setPendingAddress(addresses.length === 1 ? addresses[0] : null);
    startTransition(async () => {
      await archiveSenders(addresses);
      setRows((prev) => prev.filter((row) => !addresses.includes(row.fromAddress)));
      setSelected((prev) => {
        const next = new Set(prev);
        addresses.forEach((address) => next.delete(address));
        return next;
      });
      setPendingAddress(null);
    });
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
        {someSelected ? (
          <>
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => archive(selectedIds)}
            >
              {isPending && pendingAddress === null ? <Loader2 className="animate-spin" /> : <Archive />}
              Archive selected
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{rows.length.toLocaleString("en-US")} senders</span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>Sender</TableHead>
            <TableHead className="text-right">In inbox</TableHead>
            <TableHead className="text-right">Unread</TableHead>
            <TableHead>Last email</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((sender) => (
            <TableRow key={sender.fromAddress}>
              <TableCell>
                <Checkbox
                  checked={selected.has(sender.fromAddress)}
                  onCheckedChange={() => toggleOne(sender.fromAddress)}
                  aria-label="Select sender"
                />
              </TableCell>
              <TableCell>
                <div className="font-medium">{sender.fromName || sender.fromAddress}</div>
                <div className="text-xs text-muted-foreground">{sender.fromAddress}</div>
              </TableCell>
              <TableCell className="text-right">{sender.inboxCount.toLocaleString("en-US")}</TableCell>
              <TableCell className="text-right">
                {sender.unreadCount > 0 ? (
                  <Badge variant="secondary" className="font-normal">
                    {sender.unreadCount.toLocaleString("en-US")}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{formatDate(sender.lastDateIso)}</TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => archive([sender.fromAddress])}
                >
                  {isPending && pendingAddress === sender.fromAddress && <Loader2 className="animate-spin" />}
                  Archive
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing left to archive.</p>
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
  );
}
