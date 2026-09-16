"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Forward, Loader2 } from "lucide-react";
import { forwardMessage } from "@/app/mail-actions";

export function ForwardButton({ messageId, subject }: { messageId: string; subject: string | null }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function send() {
    if (!to.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await forwardMessage(messageId, to.trim(), note);
        setOpen(false);
        setTo("");
        setNote("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Forward className="h-3.5 w-3.5" /> Forward
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription>{subject || "(no subject)"}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="forward-to" className="text-sm font-medium">
              To
            </label>
            <Input id="forward-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="someone@example.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="forward-note" className="text-sm font-medium">
              Note (optional)
            </label>
            <Textarea id="forward-note" value={note} onChange={(e) => setNote(e.target.value)} className="min-h-20" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" onClick={send} disabled={isPending || !to.trim()}>
            {isPending ? <Loader2 className="animate-spin" /> : null}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
