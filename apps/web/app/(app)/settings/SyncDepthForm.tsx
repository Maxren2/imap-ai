"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check } from "lucide-react";
import { applySyncDepth, getSettingsBackgroundRuns, type SyncDepthData } from "./actions";
import { BackgroundRunsPanel } from "@/components/BackgroundRunsPanel";
import type { BackgroundRunRow } from "@/lib/background-run";

const DEPTH_OPTIONS: { label: string; days: number }[] = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All history", days: 0 },
];

export function SyncDepthForm({ initial, initialRuns }: { initial: SyncDepthData; initialRuns: BackgroundRunRow[] }) {
  const [depthDays, setDepthDays] = useState(initial.syncDepthDays);
  const [isApplying, startApply] = useTransition();
  const [applied, setApplied] = useState(false);

  function apply() {
    setApplied(false);
    startApply(async () => {
      await applySyncDepth(depthDays);
      setApplied(true);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        How far back to sync <span className="font-medium text-foreground">{initial.accountEmail}</span>. Changing
        this fetches any newly-included older mail in the background -- it never deletes mail you've already synced.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(depthDays)} onValueChange={(v) => setDepthDays(Number(v))}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEPTH_OPTIONS.map((opt) => (
              <SelectItem key={opt.days} value={String(opt.days)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" size="sm" disabled={isApplying || depthDays === initial.syncDepthDays} onClick={apply}>
          {isApplying ? <Loader2 className="animate-spin" /> : null}
          Apply
        </Button>
        {applied && !isApplying && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="h-3.5 w-3.5" /> Applied
          </span>
        )}
      </div>
      <BackgroundRunsPanel initialRuns={initialRuns} fetchRuns={getSettingsBackgroundRuns} />
    </div>
  );
}
