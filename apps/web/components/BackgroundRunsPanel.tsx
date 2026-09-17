"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import type { BackgroundRunRow } from "@/lib/background-run";
import { cancelRun } from "@/app/mail-actions";

const POLL_MS = 2000;

function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "running") {
    return (
      <Badge variant="secondary" className="font-normal">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Running
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="destructive" className="font-normal">
        Failed
      </Badge>
    );
  }
  if (status === "cancelled") {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        Cancelled
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal">
      Succeeded
    </Badge>
  );
}

/**
 * Shared by /rules ("Run detection now" / "Apply pending actions now") and
 * the homepage ("Sync full history" / backfill) -- `fetchRuns` is passed in
 * (rather than imported directly) so each caller can scope which
 * BackgroundRun `kind`s it polls for, since both pages share one
 * BackgroundRun table.
 */
export function BackgroundRunsPanel({
  initialRuns,
  fetchRuns,
}: {
  initialRuns: BackgroundRunRow[];
  fetchRuns: () => Promise<BackgroundRunRow[]>;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [isPending, startTransition] = useTransition();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const router = useRouter();

  function handleCancel(runId: string) {
    setCancellingId(runId);
    startTransition(async () => {
      await cancelRun(runId);
      setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, status: "cancelled" } : r)));
      setCancellingId(null);
      // A cancelled sync/rules run can still have written real partial
      // data before it stopped -- refresh so that's reflected rather than
      // silently left stale until the next unrelated navigation.
      router.refresh();
    });
  }

  // A plain `useState(initialRuns)` only uses the prop on first mount --
  // when a trigger form submits and Next.js revalidates the page, this
  // component gets fresh `initialRuns` props (now including the
  // just-started run), but without this effect the already-mounted
  // component would keep showing whatever it first rendered, since
  // useState's initializer argument is ignored on re-renders. Found live:
  // clicking the button created a real new running row in the database,
  // but the panel kept showing the previous (already-finished) one.
  useEffect(() => {
    setRuns(initialRuns);
  }, [initialRuns]);

  // Polls independently of the above -- once any run is "running" (either
  // from the initial/revalidated props, or from a previous poll tick),
  // keep refetching on an interval until nothing is running anymore.
  //
  // Updating `runs` here only ever re-renders this panel -- the actual
  // data a finished sync/backfill/rules run produced (the inbox's thread
  // list, its message count, rule match counts, ...) lives in sibling
  // Server Components on the same page, which this panel has no way to
  // re-fetch on its own. Found live: "Sync now" correctly showed
  // "Succeeded" here, but the inbox below it stayed on 0 messages until
  // the page was manually reloaded. `router.refresh()` re-runs the page's
  // server-side data fetching in place (no full navigation, scroll
  // position kept) -- fired only on the actual running -> not-running
  // transition, not on every poll tick, so it doesn't refetch the page
  // repeatedly while a run is still in progress.
  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = setTimeout(async () => {
      const next = await fetchRuns();
      const stillRunning = new Set(next.filter((r) => r.status === "running").map((r) => r.id));
      const justFinished = runs.some((r) => r.status === "running" && !stillRunning.has(r.id));
      setRuns(next);
      if (justFinished) router.refresh();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [runs, fetchRuns, router]);

  if (runs.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {runs.map((run) => (
        <details key={run.id} className="rounded-lg border" open={run.status === "running"}>
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{run.kind}</span>
            <StatusBadge status={run.status} />
            <span className="text-xs text-muted-foreground">
              {new Date(run.startedAtIso).toLocaleTimeString()} · {formatDuration(run.startedAtIso, run.finishedAtIso)}
            </span>
            {run.status === "running" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto h-6 px-2 text-xs"
                disabled={isPending && cancellingId === run.id}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleCancel(run.id);
                }}
              >
                {isPending && cancellingId === run.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                Cancel
              </Button>
            )}
          </summary>
          <pre className="max-h-64 overflow-auto border-t bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap">
            {run.log || "Waiting for output..."}
          </pre>
        </details>
      ))}
    </div>
  );
}
