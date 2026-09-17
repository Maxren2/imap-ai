"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Loader2 } from "lucide-react";
import { disconnectCalendar } from "./actions";

/**
 * Lighter-weight than RemoveAccountButton's type-to-confirm pattern
 * (apps/web/app/add-account/RemoveAccountButton.tsx) on purpose --
 * disconnecting a calendar only revokes this app's read access to it,
 * with no synced mail/rules/chat history cascading away (see
 * CalendarConnection's schema comment: it holds nothing but a refresh
 * token). Reconnecting is a single click away, so a plain confirm dialog
 * is proportionate.
 */
export function DisconnectCalendarButton({ connectionId, email }: { connectionId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirmDisconnect() {
    startTransition(async () => {
      await disconnectCalendar(connectionId);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Disconnect
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {email}?</DialogTitle>
          <DialogDescription>
            Stops checking this calendar for busy times when drafting scheduling replies. No synced mail or other
            data is affected -- reconnect any time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="destructive" onClick={confirmDisconnect} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : null}
            Disconnect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
