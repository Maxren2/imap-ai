"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchMail, type MailSearchResult } from "@/app/mail-actions";

export function MailSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MailSearchResult[] | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => {
        setResults(await searchMail(trimmed));
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  return (
    <div className="mb-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search mail by sender or subject..."
          className="pl-8 pr-8"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {results !== null && (
        <div className="mt-2 rounded-lg border">
          {isPending ? (
            <p className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching...
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No mail matches &ldquo;{query}&rdquo;.</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.id} className="border-b last:border-b-0">
                  <Link
                    href={`/thread/${r.gmailThreadId ?? r.id}`}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40"
                  >
                    <span className="w-36 shrink-0 truncate">{r.fromName || r.fromAddress || "Unknown"}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      <span className="text-foreground">{r.subject || "(no subject)"}</span>
                      {r.snippet && ` — ${r.snippet}`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
