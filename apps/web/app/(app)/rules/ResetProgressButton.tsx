"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, Loader2 } from "lucide-react";
import { resetRuleProgress } from "./actions";

export function ResetProgressButton({ ruleId, matchCount }: { ruleId: string; matchCount: number }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const confirmed = window.confirm(
      `Re-evaluate every synced message against this rule from scratch?\n\n` +
        `This forgets which of your ${matchCount.toLocaleString()} current match(es) and previously-checked messages were already considered, so the next "Run detection now" starts over. It does NOT undo any action already applied (archive/label/etc. stays as-is).`,
    );
    if (confirmed) startTransition(() => resetRuleProgress(ruleId));
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      {isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
      Reset & reprocess all mail
    </Button>
  );
}
