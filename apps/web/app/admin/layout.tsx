import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/session";
import { logout } from "@/app/logout-action";

/**
 * Deliberately NOT inside (app)/'s layout -- that one gates on
 * getActiveEmailAccount(), which redirects anyone with zero linked
 * mailboxes to /add-account before their page ever renders. An admin
 * managing users doesn't need a linked mailbox at all (and a fresh
 * install's very first admin, per definition, hasn't linked one yet the
 * moment they sign up) -- this layout only requires the admin role
 * itself, checked directly by requireAdmin(), with its own minimal chrome
 * instead of the full mail-app sidebar.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-background">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            i
          </div>
          <span className="font-semibold">imap-ai admin</span>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href="/">
              <ArrowLeft /> Back to app
            </Link>
          </Button>
          <form action={logout}>
            <Button type="submit" size="sm" variant="ghost">
              <LogOut /> Sign out
            </Button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
