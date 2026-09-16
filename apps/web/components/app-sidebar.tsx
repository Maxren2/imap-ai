"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Inbox, MessageCircle, Sparkles, MailX, Archive, BarChart3, Hourglass, ShieldOff, Moon, Brush } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  soon?: boolean;
  // inbox-zero groups its real sidebar nav under labeled sections
  // ("Manage", "Cleanup", a collapsible "Tools") -- confirmed live in
  // DESIGN.md section 33/36. imap-ai's feature set doesn't map onto its
  // exact groups (no Channels, Calendars, or Attachments pages), so this
  // is an adapted two-group split rather than a literal copy: Inbox stays
  // ungrouped at the top (the sidebar-less Mail layout doesn't even show
  // this sidebar, so there's no real inbox-zero equivalent to match here
  // either way), everything conversational under "Manage", everything
  // inbox-cleanup-flavored under "Cleanup".
  group?: "manage" | "cleanup";
}

export const navItems: NavItem[] = [
  { title: "Inbox", href: "/", icon: Inbox },
  { title: "Chat", href: "/chat", icon: MessageCircle, group: "manage" },
  { title: "Assistant", href: "/rules", icon: Sparkles, group: "manage" },
  { title: "Bulk Unsubscribe", href: "/bulk-unsubscribe", icon: MailX, group: "cleanup" },
  { title: "Bulk Archive", href: "/bulk-archive", icon: Archive, group: "cleanup" },
  { title: "No-Reply", href: "/no-reply", icon: Hourglass, group: "cleanup" },
  { title: "Cold Email Blocker", href: "/cold-email-blocker", icon: ShieldOff, group: "cleanup" },
  { title: "Deep Clean", href: "/deep-clean", icon: Brush, group: "cleanup" },
  { title: "Analytics", href: "/stats", icon: BarChart3, group: "cleanup" },
];

function DarkModeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // next-themes doesn't know the resolved theme until after mount (it reads
  // localStorage/media query client-side) -- rendering the Switch's checked
  // state before that would flash the wrong position or mismatch SSR output.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
      <span className="flex items-center gap-2 text-sm text-sidebar-foreground">
        <Moon className="h-4 w-4" /> Dark mode
      </span>
      <Switch
        aria-label="Toggle dark mode"
        checked={mounted && resolvedTheme === "dark"}
        disabled={!mounted}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
      />
    </div>
  );
}

function NavItems({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <SidebarMenu>
      {items.map((item) => {
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
  );
}

export function AppSidebar() {
  const pathname = usePathname();
  const ungrouped = navItems.filter((item) => !item.group);
  const manageItems = navItems.filter((item) => item.group === "manage");
  const cleanupItems = navItems.filter((item) => item.group === "cleanup");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            i
          </div>
          <span className="font-semibold group-data-[collapsible=icon]:hidden">imap-ai</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <NavItems items={ungrouped} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={manageItems} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Cleanup</SidebarGroupLabel>
          <SidebarGroupContent>
            <NavItems items={cleanupItems} pathname={pathname} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <DarkModeToggle />
      </SidebarFooter>
    </Sidebar>
  );
}
