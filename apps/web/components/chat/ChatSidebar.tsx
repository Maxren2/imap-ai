"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { createChat, renameChat, deleteChat } from "@/app/chat/actions";

export interface ChatSidebarRow {
  id: string;
  name: string | null;
  createdAtIso: string;
}

function chatLabel(chat: Pick<ChatSidebarRow, "name" | "createdAtIso">): string {
  // Pinned locale, not the browser's -- this renders in a client component
  // during SSR too, and an implicit/undefined locale formats differently
  // server- vs client-side (Node's default vs the browser's), which fails
  // React's hydration check. Same class of bug as thread-list.tsx's count
  // formatting (see project memory phase 15) -- caught here live the same
  // way, via the dev server's hydration-mismatch log, not typecheck.
  return chat.name ?? `Chat from ${new Date(chat.createdAtIso).toLocaleString("en-US")}`;
}

export function ChatSidebar({ chats }: { chats: ChatSidebarRow[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeChatId = pathname.match(/^\/chat\/([^/]+)/)?.[1];
  const [renaming, setRenaming] = useState<ChatSidebarRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(chat: ChatSidebarRow) {
    startTransition(async () => {
      await deleteChat(chat.id, chat.id === activeChatId);
    });
  }

  return (
    <div className="flex w-56 shrink-0 flex-col border-r">
      <div className="border-b p-2">
        <form action={createChat}>
          <Button type="submit" size="sm" variant="outline" className="w-full justify-start">
            <Plus /> New chat
          </Button>
        </form>
      </div>
      <div className="flex-1 overflow-auto p-1">
        {chats.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">No chats yet.</p>
        ) : (
          chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            return (
              <div key={chat.id} className="group/chat-row relative flex items-center">
                <Link
                  href={`/chat/${chat.id}`}
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 pr-8 text-sm hover:bg-muted",
                    isActive && "bg-muted font-medium",
                  )}
                >
                  {chatLabel(chat)}
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Chat options"
                      className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover/chat-row:opacity-100"
                    >
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setRenaming(chat)}>
                      <Pencil className="mr-2 size-4" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => handleDelete(chat)}
                      disabled={isPending}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 size-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })
        )}
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
          </DialogHeader>
          {renaming && (
            <form
              action={async (formData) => {
                await renameChat(formData);
                setRenaming(null);
                router.refresh();
              }}
            >
              <input type="hidden" name="chatId" value={renaming.id} />
              <Input name="name" defaultValue={renaming.name ?? ""} placeholder={chatLabel(renaming)} autoFocus />
              <DialogFooter className="mt-4">
                <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
