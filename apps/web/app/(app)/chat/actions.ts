"use server";

import { prisma } from "@imap-ai/core/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createChat(): Promise<void> {
  const account = await prisma.account.findFirstOrThrow();
  const chat = await prisma.chat.create({ data: { accountId: account.id } });
  revalidatePath("/chat");
  redirect(`/chat/${chat.id}`);
}

export async function renameChat(formData: FormData): Promise<void> {
  const chatId = formData.get("chatId") as string;
  const name = (formData.get("name") as string | null)?.trim() || null;
  await prisma.chat.update({ where: { id: chatId }, data: { name } });
  revalidatePath("/chat");
}

/**
 * `wasActive` tells us whether the deleted chat was the one currently being
 * viewed -- if so, redirect straight to the next most recent remaining
 * thread (or a freshly created one if that was the last thread left).
 *
 * Deliberately resolves the target here rather than redirecting to /chat
 * and letting its own index-page logic do the same resolution: chaining
 * two server-side redirects in one request left the layout (the sidebar)
 * rendered with the stale pre-delete chat list from the first redirect's
 * render pass, never picking up the newly created chat -- found live, not
 * by inspection, when a delete-the-last-remaining-chat test left the
 * sidebar reading "No chats yet" even though the new chat's own page had
 * loaded correctly at its real URL. A single redirect avoids the issue.
 */
export async function deleteChat(chatId: string, wasActive: boolean): Promise<void> {
  const account = await prisma.account.findFirstOrThrow();
  await prisma.chat.delete({ where: { id: chatId } });
  revalidatePath("/chat");

  if (!wasActive) return;

  const mostRecentChat = await prisma.chat.findFirst({
    where: { accountId: account.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (mostRecentChat) {
    redirect(`/chat/${mostRecentChat.id}`);
  }
  const chat = await prisma.chat.create({ data: { accountId: account.id } });
  redirect(`/chat/${chat.id}`);
}
