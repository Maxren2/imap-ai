"use client";

import { useState, useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check } from "lucide-react";
import { updateLlmPreference, type LlmPreferenceData } from "./actions";

const INSTANCE_DEFAULT_VALUE = "__default__";

export function LlmPreferenceForm({ initial }: { initial: LlmPreferenceData }) {
  const [value, setValue] = useState(initial.preferredModelId ?? INSTANCE_DEFAULT_VALUE);
  const [isSaving, startSaving] = useTransition();
  const [saved, setSaved] = useState(false);

  function save(next: string) {
    setValue(next);
    setSaved(false);
    startSaving(async () => {
      await updateLlmPreference(next === INSTANCE_DEFAULT_VALUE ? null : next);
      setSaved(true);
    });
  }

  const defaultLabel = initial.defaultModelLabel ? `Use instance default (${initial.defaultModelLabel})` : "Use instance default (none set)";

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Which LLM your own rule matching, drafts, and chat use.</p>
      <div className="flex items-center gap-3">
        <Select value={value} onValueChange={save}>
          <SelectTrigger className="w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INSTANCE_DEFAULT_VALUE}>{defaultLabel}</SelectItem>
            {initial.options.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSaving ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        {saved && !isSaving && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
      {initial.options.length === 0 && (
        <p className="text-xs text-muted-foreground">Your admin hasn&apos;t enabled any models for users to pick yet.</p>
      )}
    </div>
  );
}
