"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import type { BackgroundRunRow } from "@/lib/background-run";

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
  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = setTimeout(async () => {
      setRuns(await fetchRuns());
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [runs, fetchRuns]);

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
          </summary>
          <pre className="max-h-64 overflow-auto border-t bg-muted/30 px-3 py-2 text-xs whitespace-pre-wrap">
            {run.log || "Waiting for output..."}
          </pre>
        </details>
      ))}
    </div>
  );
}
