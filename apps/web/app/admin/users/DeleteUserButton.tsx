"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Trash2, Loader2 } from "lucide-react";
import { deleteUser } from "./actions";

/**
 * Deleting a user is a real, hard-to-reverse loss of this app's local
 * data for them (synced mail mirror, rules, chat history -- see
 * actions.ts's deleteUser comment) -- typing their email exactly is a
 * deliberate extra step against a misclick, the same "type to confirm"
 * pattern used for destructive actions in many real apps, since a native
 * confirm() dialog alone is both weaker and (per this project's own
 * experience automating one elsewhere) not something this session's
 * browser tooling can even drive for live verification.
 */
export function DeleteUserButton({ userId, email }: { userId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteUser(userId);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {email}?</DialogTitle>
          <DialogDescription>
            Permanently deletes this user and every linked mailbox&apos;s synced mail mirror, rules, and chat
            history from imap-ai&apos;s database. The real mailbox on the mail server itself is untouched -- this
            only removes what this app has stored locally. Cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-email" className="text-sm font-medium">
            Type <span className="font-mono">{email}</span> to confirm
          </label>
          <Input id="confirm-email" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="destructive" onClick={confirmDelete} disabled={isPending || confirmText !== email}>
            {isPending ? <Loader2 className="animate-spin" /> : null}
            Delete user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
