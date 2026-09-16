import { prisma } from "@imap-ai/core/db";
import { redirect } from "next/navigation";
import { getActiveEmailAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * /chat has no thread of its own -- it resolves to the most recently
 * updated thread (or creates a fresh one if this account has none yet) and
 * redirects there. The actual chat UI lives at /chat/[chatId].
 */
export default async function ChatIndexPage() {
  const account = await getActiveEmailAccount();

  const mostRecentChat = await prisma.chat.findFirst({
    where: { accountId: account.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  if (mostRecentChat) redirect(`/chat/${mostRecentChat.id}`);

  const chat = await prisma.chat.create({ data: { accountId: account.id } });
  redirect(`/chat/${chat.id}`);
}
