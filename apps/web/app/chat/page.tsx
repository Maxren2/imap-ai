import { prisma } from "@imap-ai/core/db";
import type { UIMessage } from "ai";
import { ChatClient } from "@/components/chat/chat-client";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const account = await prisma.account.findFirst();

  const chatMessages = account
    ? await prisma.chat
        .findUnique({
          where: { accountId: account.id },
          include: { messages: { orderBy: { createdAt: "asc" } } },
        })
        .then((chat) => chat?.messages ?? [])
    : [];

  const initialMessages: UIMessage[] = chatMessages.map((message) => ({
    id: message.id,
    role: message.role as UIMessage["role"],
    parts: message.parts as unknown as UIMessage["parts"],
  }));

  return <ChatClient initialMessages={initialMessages} />;
}
