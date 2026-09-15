"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Eye, Sparkles } from "lucide-react";
import { previewDeepClean, triggerDeepClean, type DeepCleanOptions } from "./actions";
import { BackgroundRunsPanel } from "@/components/BackgroundRunsPanel";
import { getLatestDeepCleanRuns } from "./actions";
import type { BackgroundRunRow } from "@/lib/background-run";

const AGE_OPTIONS: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "365 days", days: 365 },
  { label: "Any age", days: null },
];

export function DeepCleanForm({ initialRuns }: { initialRuns: BackgroundRunRow[] }) {
  const [action, setAction] = useState<DeepCleanOptions["action"]>("archive");
  const [olderThanDays, setOlderThanDays] = useState<number | null>(90);
  const [skipStarred, setSkipStarred] = useState(true);
  const [skipSent, setSkipSent] = useState(true);
  const [skipReceipts, setSkipReceipts] = useState(true);

  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [isPreviewing, startPreview] = useTransition();
  const [isTriggering, startTrigger] = useTransition();

  const options: DeepCleanOptions = { action, olderThanDays, skipStarred, skipSent, skipReceipts };

  function updateAndInvalidate<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setPreviewCount(null);
  }

  function runPreview() {
    startPreview(async () => {
      setPreviewCount(await previewDeepClean(options));
    });
  }

  function runDeepClean() {
    startTrigger(async () => {
      await triggerDeepClean(options);
      setPreviewCount(null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Action</label>
          <Select value={action} onValueChange={(v) => updateAndInvalidate(setAction, v as DeepCleanOptions["action"])}>
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="archive">Archive</SelectItem>
              <SelectItem value="markRead">Mark as read</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-sm font-medium">Older than</label>
          <Select
            value={String(olderThanDays)}
            onValueChange={(v) => updateAndInvalidate(setOlderThanDays, v === "null" ? null : Number(v))}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGE_OPTIONS.map((opt) => (
                <SelectItem key={opt.label} value={opt.days === null ? "null" : String(opt.days)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">Skip</p>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={skipStarred} onCheckedChange={(v) => updateAndInvalidate(setSkipStarred, v === true)} />
            Starred mail
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={skipSent} onCheckedChange={(v) => updateAndInvalidate(setSkipSent, v === true)} />
            Mail you sent
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={skipReceipts} onCheckedChange={(v) => updateAndInvalidate(setSkipReceipts, v === true)} />
            Likely receipts (invoices, orders, billing)
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={isPreviewing} onClick={runPreview}>
          {isPreviewing ? <Loader2 className="animate-spin" /> : <Eye />}
          Preview
        </Button>
        {previewCount !== null && (
          <span className="text-sm text-muted-foreground">
            {previewCount.toLocaleString("en-US")} message{previewCount === 1 ? "" : "s"} would be{" "}
            {action === "archive" ? "archived" : "marked read"}.
          </span>
        )}
      </div>

      <Button type="button" size="sm" disabled={previewCount === null || previewCount === 0 || isTriggering} onClick={runDeepClean}>
        {isTriggering ? <Loader2 className="animate-spin" /> : <Sparkles />}
        Run Deep Clean
      </Button>
      <p className="text-xs text-muted-foreground">
        Preview first so the run does what you expect -- runs in the background, never deletes anything, and every
        action here (archive, mark read) is reversible.
      </p>

      <BackgroundRunsPanel initialRuns={initialRuns} fetchRuns={getLatestDeepCleanRuns} />
    </div>
  );
}
