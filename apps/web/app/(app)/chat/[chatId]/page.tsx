import { prisma } from "@imap-ai/core/db";
import { notFound } from "next/navigation";
import type { UIMessage } from "ai";
import { ChatClient } from "@/components/chat/chat-client";

export const dynamic = "force-dynamic";

export default async function ChatThreadPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!chat) notFound();

  const initialMessages: UIMessage[] = chat.messages.map((message) => ({
    id: message.id,
    role: message.role as UIMessage["role"],
    parts: message.parts as unknown as UIMessage["parts"],
  }));

  return <ChatClient key={chatId} chatId={chatId} initialMessages={initialMessages} />;
}
