"use server";

import { prisma } from "@imap-ai/core/db";
import { connectImap, requireEnv } from "@imap-ai/core/imap-connect";
import { applyRuleActions } from "@imap-ai/core/rules/actions";
import { revalidatePath } from "next/cache";

/**
 * Archives messages directly from the mail list (not via the rules
 * engine). Reuses the same IMAP MOVE-to-All-Mail logic as rule action
 * execution (see DESIGN.md section 8 for why: removing \Inbox via
 * X-GM-LABELS is a silent no-op on Gmail).
 *
 * After the real IMAP move, `inInbox` is set false locally so the Inbox
 * view updates immediately (see DESIGN.md section 11 -- `labels` can't be
 * used for this: Gmail omits "\Inbox" from X-GM-LABELS when a message is
 * fetched from within INBOX itself). The row's mailboxId/uid are
 * deliberately left pointing at the old INBOX position rather than
 * tracking the message into an "All Mail" mailbox we don't sync
 * separately; a moved message just won't be actionable via IMAP again
 * until a future sync properly tracks it there.
 */
export async function archiveMessages(messageIds: string[]): Promise<{ archived: number }> {
  if (messageIds.length === 0) return { archived: 0 };

  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds } },
    select: { id: true, uid: true },
  });
  if (messages.length === 0) return { archived: 0 };

  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
  const lock = await client.getMailboxLock("INBOX");

  let archived = 0;
  try {
    for (const message of messages) {
      try {
        await applyRuleActions(client, message.uid, [{ type: "archive" }]);
        await prisma.message.update({ where: { id: message.id }, data: { inInbox: false } });
        archived++;
      } catch (error) {
        console.error(`Failed to archive message ${message.id}:`, error);
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  revalidatePath("/");
  return { archived };
}
