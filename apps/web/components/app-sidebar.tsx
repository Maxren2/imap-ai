"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, MessageCircle, Sparkles, MailX, Archive, BarChart3 } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
}

const navItems: NavItem[] = [
  { title: "Inbox", href: "/", icon: Inbox },
  { title: "Chat", href: "/chat", icon: MessageCircle },
  { title: "Assistant", href: "/rules", icon: Sparkles },
  { title: "Bulk Unsubscribe", href: "/bulk-unsubscribe", icon: MailX },
  { title: "Bulk Archive", href: "/bulk-archive", icon: Archive, soon: true },
  { title: "Analytics", href: "/stats", icon: BarChart3, soon: true },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            i
          </div>
          <span className="font-semibold group-data-[collapsible=icon]:hidden">imap-ai</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Mail</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive} disabled={item.soon} tooltip={item.title}>
                      {item.soon ? (
                        <span className={cn("cursor-default opacity-60")}>
                          <item.icon />
                          <span>{item.title}</span>
                        </span>
                      ) : (
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.title}</span>
                        </Link>
                      )}
                    </SidebarMenuButton>
                    {item.soon && <SidebarMenuBadge>Soon</SidebarMenuBadge>}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
