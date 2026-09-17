"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Check } from "lucide-react";
import { updateAvailability, type AvailabilityData } from "./actions";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

export function AvailabilityForm({ initial }: { initial: AvailabilityData }) {
  const [timezone, setTimezone] = useState(initial.timezone);
  const [days, setDays] = useState<string[]>(initial.days);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [isSaving, startSave] = useTransition();
  const [saved, setSaved] = useState(false);

  function toggleDay(key: string) {
    setSaved(false);
    setDays((prev) => (prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]));
  }

  function save() {
    startSave(async () => {
      await updateAvailability({ timezone, days, start, end });
      setSaved(true);
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Used when a scheduling reply is drafted (the draft/auto-reply rule actions) alongside your connected
        calendars' busy times, so the AI can propose real free slots -- see the{" "}
        <a href="/calendar" className="underline underline-offset-4">
          Calendar
        </a>{" "}
        page to connect one.
      </p>

      <div>
        <label className="text-sm font-medium">Timezone (IANA, e.g. Europe/Zurich)</label>
        <Input
          className="mt-1.5 max-w-xs"
          value={timezone}
          placeholder="Europe/Zurich"
          onChange={(e) => {
            setTimezone(e.target.value);
            setSaved(false);
          }}
        />
      </div>

      <div>
        <p className="text-sm font-medium">Available days</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {DAYS.map((d) => (
            <label key={d.key} className="flex items-center gap-1.5 text-sm">
              <Checkbox checked={days.includes(d.key)} onCheckedChange={() => toggleDay(d.key)} />
              {d.label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-3">
        <div>
          <label className="text-sm font-medium">Start</label>
          <Input
            type="time"
            className="mt-1.5 w-32"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              setSaved(false);
            }}
          />
        </div>
        <div>
          <label className="text-sm font-medium">End</label>
          <Input
            type="time"
            className="mt-1.5 w-32"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              setSaved(false);
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={isSaving} onClick={save}>
          {isSaving ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
        {saved && !isSaving && (
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Check className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
