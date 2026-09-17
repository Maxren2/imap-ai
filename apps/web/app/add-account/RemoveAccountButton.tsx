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
import { removeAccount } from "@/app/account-actions";

/**
 * Removing a linked mailbox deletes this app's entire local mirror for it
 * (synced mail, rules, chat history, rule matches -- all Cascade in
 * schema.prisma from EmailAccount) -- not the real mailbox on the mail
 * server, and not the signed-in user account itself, just this one
 * linked inbox. A real, hard-to-reverse loss of local data, so the same
 * type-to-confirm pattern as the admin user-delete dialog
 * (apps/admin/users/DeleteUserButton.tsx) applies here too, for the same
 * reasons: a native confirm() is both weaker and not something this
 * project's own live-verification tooling can drive.
 */
export function RemoveAccountButton({ accountId, email }: { accountId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirmRemove() {
    setError(null);
    startTransition(async () => {
      try {
        await removeAccount(accountId);
      } catch (e) {
        // removeAccount's own success path ends in redirect("/"), which
        // Next.js implements by throwing a special digest-tagged error
        // that must propagate up to the framework, not get swallowed here
        // as if it were a real failure (same reasoning as signup/actions.ts's
        // own AuthError-vs-redirect distinction).
        if (e && typeof e === "object" && "digest" in e && typeof e.digest === "string" && e.digest.startsWith("NEXT_REDIRECT")) {
          throw e;
        }
        setError(e instanceof Error ? e.message : "Failed to remove.");
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
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {email}?</DialogTitle>
          <DialogDescription>
            Permanently deletes this mailbox&apos;s synced mail mirror, rules, and chat history from imap-ai&apos;s
            database. The real mailbox on the mail server is untouched -- this only removes what this app has stored
            locally. Your login itself isn&apos;t affected. Cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm-remove-email" className="text-sm font-medium">
            Type <span className="font-mono">{email}</span> to confirm
          </label>
          <Input id="confirm-remove-email" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="destructive" onClick={confirmRemove} disabled={isPending || confirmText !== email}>
            {isPending ? <Loader2 className="animate-spin" /> : null}
            Remove mailbox
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
