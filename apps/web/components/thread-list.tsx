"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Archive, Loader2, CheckCircle2 } from "lucide-react";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { archiveThreads, fetchMissingSnippets, getInboxThreads, type ThreadListMessagePlain } from "@/app/mail-actions";

export type ThreadListMessage = ThreadListMessagePlain;

function initials(name: string | null, address: string | null): string {
  const source = name || address || "?";
  const parts = source.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (diffHours < 24 * 7) {
    return date.toLocaleDateString(undefined, { weekday: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Row selection/archive keys off the thread, not the individual displayed message -- see archiveThreads. */
function threadKey(message: ThreadListMessage): string {
  return message.gmailThreadId ?? message.id;
}

export function ThreadList({
  messages,
  totalCount,
  pageSize,
}: {
  messages: ThreadListMessage[];
  totalCount: number;
  pageSize: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [localMessages, setLocalMessages] = useState(messages);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  // A page can return fewer rows than requested even when more exist further
  // back (rare, but possible after this page's own archive actions remove
  // rows) -- track "more to load" from the actual last response size
  // instead of assuming exactly `pageSize` always means there's another
  // page, and stop for good once a response comes back short.
  const [hasMore, setHasMore] = useState(messages.length === pageSize && messages.length < totalCount);

  const allSelected = localMessages.length > 0 && selected.size === localMessages.length;
  const someSelected = selected.size > 0;

  useEffect(() => {
    const missingIds = messages.filter((m) => !m.bodyFetched).map((m) => m.id);
    if (missingIds.length === 0) return;

    let cancelled = false;
    fetchMissingSnippets(missingIds).then((snippets) => {
      if (cancelled) return;
      setLocalMessages((prev) =>
        prev.map((m) => (m.id in snippets ? { ...m, snippet: snippets[m.id], bodyFetched: true } : m)),
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(localMessages.map(threadKey)));
  }

  function toggleOne(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function archiveKeys(keys: string[]) {
    startTransition(async () => {
      await archiveThreads(keys);
      setLocalMessages((prev) => prev.filter((m) => !keys.includes(threadKey(m))));
      setSelected((prev) => {
        const next = new Set(prev);
        keys.forEach((key) => next.delete(key));
        return next;
      });
    });
  }

  const selectedKeys = useMemo(() => Array.from(selected), [selected]);

  async function loadMore() {
    if (localMessages.length === 0) return;
    setIsLoadingMore(true);
    try {
      const oldestDateIso = localMessages[localMessages.length - 1].dateIso;
      const next = await getInboxThreads(oldestDateIso);
      setLocalMessages((prev) => [...prev, ...next]);
      setHasMore(next.length === pageSize);
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
        {someSelected ? (
          <>
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => archiveKeys(selectedKeys)}>
              {isPending ? <Loader2 className="animate-spin" /> : <Archive />}
              Archive
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{localMessages.length.toLocaleString("en-US")} threads</span>
        )}
      </div>

      <ul>
        {localMessages.map((message) => {
          const key = threadKey(message);
          const isUnread = message.hasUnread;
          const displayName = message.fromName || message.fromAddress || "Unknown";
          const visibleLabels = message.labels.filter((label) => !label.startsWith("\\"));

          return (
            <li
              key={key}
              className={cn(
                "group flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40",
                isUnread && "bg-background font-medium",
              )}
            >
              <Checkbox checked={selected.has(key)} onCheckedChange={() => toggleOne(key)} aria-label="Select thread" />
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-xs">{initials(message.fromName, message.fromAddress)}</AvatarFallback>
              </Avatar>
              <span className="flex w-36 shrink-0 items-baseline gap-1 truncate text-sm">
                <span className="truncate">{displayName}</span>
                {/* Inline count after the name, matching inbox-zero's real
                    rendering ("Google 2") confirmed live -- not a separate
                    badge off to the side. */}
                {message.messageCount > 1 && (
                  <span className="shrink-0 text-xs font-normal text-muted-foreground">{message.messageCount}</span>
                )}
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-sm", !isUnread && "text-muted-foreground")}>
                {message.subject || "(no subject)"}
                {message.snippet && <span className="font-normal text-muted-foreground"> — {message.snippet}</span>}
              </span>
              <div className="hidden shrink-0 gap-1 sm:flex">
                {visibleLabels.slice(0, 2).map((label) => (
                  <Badge key={label} variant="secondary" className="font-normal">
                    {label}
                  </Badge>
                ))}
              </div>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                {formatRelativeDate(message.dateIso)}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                disabled={isPending}
                onClick={() => archiveKeys([key])}
                aria-label="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </li>
          );
        })}
      </ul>

      {localMessages.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCircle2 />
            </EmptyMedia>
            <EmptyTitle>Inbox zero</EmptyTitle>
            <EmptyDescription>Nothing here. Enjoy it while it lasts.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {localMessages.length > 0 && (
        <div className="flex flex-col items-center gap-2 border-t px-3 py-3">
          <span className="text-xs text-muted-foreground">
            Showing {localMessages.length.toLocaleString("en-US")} of {totalCount.toLocaleString("en-US")} threads
          </span>
          {hasMore && (
            <Button size="sm" variant="outline" disabled={isLoadingMore} onClick={loadMore}>
              {isLoadingMore && <Loader2 className="animate-spin" />}
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
