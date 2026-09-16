import type { ReactNode } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { CommandPaletteTrigger } from "@/components/command-palette";
import { getActiveEmailAccount, listEmailAccounts } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [account, accounts] = await Promise.all([getActiveEmailAccount(), listEmailAccounts()]);

  return (
    <SidebarProvider>
      <AppSidebar accounts={accounts} activeAccountId={account.id} />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <CommandPaletteTrigger />
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
