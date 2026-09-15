"use client";

import { useState, useMemo, useTransition } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Archive, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { archiveMessages } from "@/app/mail-actions";

export interface ThreadListMessage {
  id: string;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  dateIso: string;
  labels: string[];
  flags: string[];
}

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

export function ThreadList({ messages }: { messages: ThreadListMessage[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [localMessages, setLocalMessages] = useState(messages);

  const allSelected = localMessages.length > 0 && selected.size === localMessages.length;
  const someSelected = selected.size > 0;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(localMessages.map((m) => m.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function archiveIds(ids: string[]) {
    startTransition(async () => {
      await archiveMessages(ids);
      setLocalMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    });
  }

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-3 border-b bg-muted/40 px-3 py-2">
        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
        {someSelected ? (
          <>
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => archiveIds(selectedIds)}>
              {isPending ? <Loader2 className="animate-spin" /> : <Archive />}
              Archive
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{localMessages.length.toLocaleString()} messages</span>
        )}
      </div>

      <ul>
        {localMessages.map((message) => {
          const isUnread = !message.flags.includes("\\Seen");
          const displayName = message.fromName || message.fromAddress || "Unknown";
          const visibleLabels = message.labels.filter((label) => !label.startsWith("\\"));

          return (
            <li
              key={message.id}
              className={cn(
                "group flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 hover:bg-muted/40",
                isUnread && "bg-background font-medium",
              )}
            >
              <Checkbox checked={selected.has(message.id)} onCheckedChange={() => toggleOne(message.id)} aria-label="Select message" />
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-xs">{initials(message.fromName, message.fromAddress)}</AvatarFallback>
              </Avatar>
              <span className="w-36 shrink-0 truncate text-sm">{displayName}</span>
              <span className={cn("min-w-0 flex-1 truncate text-sm", !isUnread && "text-muted-foreground")}>
                {message.subject || "(no subject)"}
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
                onClick={() => archiveIds([message.id])}
                aria-label="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </Button>
            </li>
          );
        })}
      </ul>

      {localMessages.length === 0 && (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Inbox zero. Nothing here.</p>
      )}
    </div>
  );
}
