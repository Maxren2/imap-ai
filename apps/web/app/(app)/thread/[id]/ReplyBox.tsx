"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { replyToThread } from "@/app/mail-actions";

export function ReplyBox({ threadId }: { threadId: string }) {
  const [body, setBody] = useState("");
  const [isPending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function send() {
    if (!body.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await replyToThread(threadId, body);
        setSent(true);
        setBody("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to send.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="reply-body" className="text-sm font-medium">
        Reply
      </label>
      <Textarea
        id="reply-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply..."
        className="min-h-28"
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {sent && !isPending && <p className="text-sm text-muted-foreground">Sent -- it'll show up here once your mailbox syncs.</p>}
      <div>
        <Button type="button" onClick={send} disabled={isPending || !body.trim()}>
          {isPending ? <Loader2 className="animate-spin" /> : <Send />}
          Send reply
        </Button>
      </div>
    </div>
  );
}
