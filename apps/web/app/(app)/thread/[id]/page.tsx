import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getThreadMessages } from "@/app/mail-actions";
import { ReplyBox } from "./ReplyBox";
import { ForwardButton } from "./ForwardButton";
import { EmailBody } from "@/components/EmailBody";

export const dynamic = "force-dynamic";

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const messages = await getThreadMessages(id);
  if (messages.length === 0) notFound();

  const subject = messages[messages.length - 1].subject || "(no subject)";

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Inbox
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{subject}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {messages.length} message{messages.length === 1 ? "" : "s"} in this thread
      </p>

      <div className="mt-6 flex flex-col gap-4">
        {messages.map((message) => (
          <div key={message.id} className={`rounded-lg border p-4 ${message.isUnread ? "bg-background" : "bg-muted/20"}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {message.isSentByMe ? "You" : message.fromName || message.fromAddress || "Unknown"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {message.isSentByMe ? `to ${message.toAddress ?? ""}` : message.fromAddress}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">{formatFullDate(message.dateIso)}</span>
                <ForwardButton messageId={message.id} subject={message.subject} />
              </div>
            </div>
            <EmailBody html={message.bodyHtml} text={message.body} />
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-lg border p-4">
        <ReplyBox threadId={id} />
      </div>
    </main>
  );
}
