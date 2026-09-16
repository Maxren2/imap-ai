"use client";

import { useTransition } from "react";
import Link from "next/link";
import { ChevronsUpDown, Plus, LogOut, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveAccount } from "@/app/account-actions";
import { logout } from "@/app/logout-action";

export interface AccountRow {
  id: string;
  email: string;
  provider: string;
}

// inbox-zero's real sidebar has an account-switcher card (confirmed live,
// DESIGN.md's multi-user section) -- this is the actual functional version
// of that, not just the visual shape: switching an entry here changes
// which linked mailbox every other page reads (see lib/session.ts's
// getActiveEmailAccount).
export function AccountSwitcher({ accounts, activeAccountId }: { accounts: AccountRow[]; activeAccountId: string }) {
  const [isPending, startTransition] = useTransition();
  const active = accounts.find((a) => a.id === activeAccountId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-between px-2 py-1.5" disabled={isPending}>
          <span className="flex min-w-0 items-center gap-2">
            <Mail className="h-4 w-4 shrink-0" />
            <span className="truncate text-sm font-medium">{active?.email ?? "Select account"}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Your mailboxes</DropdownMenuLabel>
        {accounts.map((account) => (
          <DropdownMenuItem
            key={account.id}
            disabled={account.id === activeAccountId}
            onSelect={() => startTransition(() => setActiveAccount(account.id))}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{account.email}</span>
              <span className="text-xs text-muted-foreground capitalize">{account.provider}</span>
            </span>
            {account.id === activeAccountId && <span className="text-xs text-muted-foreground">Active</span>}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/add-account">
            <Plus /> Add account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => startTransition(() => logout())}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
