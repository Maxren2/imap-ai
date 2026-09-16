import type { ReactNode } from "react";
import { prisma } from "@imap-ai/core/db";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { getActiveEmailAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const account = await getActiveEmailAccount();
  const chats = await prisma.chat.findMany({
    where: { accountId: account.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, createdAt: true },
  });

  const chatRows = chats.map((chat) => ({
    id: chat.id,
    name: chat.name,
    createdAtIso: chat.createdAt.toISOString(),
  }));

  return (
    <div className="flex h-[calc(100vh-3.5rem)]">
      <ChatSidebar chats={chatRows} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
