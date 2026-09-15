import type { ReactNode } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { CommandPaletteTrigger } from "@/components/command-palette";
import { ThemeToggleButton } from "@/components/theme-toggle-button";

// inbox-zero's real Mail route (`/mail`) has no sidebar showing at all --
// confirmed live during the visual-polish research (DESIGN.md section 33
// item 2), a genuine structural difference from every other page, not just
// a color gap. This mirrors that: no <AppSidebar/>, just a focused header.
//
// Two deliberate adaptations rather than a literal copy, both noted here
// since they're real product differences, not oversights:
//  - inbox-zero's sidebar is still reachable from this route via a
//    collapse toggle; imap-ai's sidebar isn't rendered here at all, so the
//    command palette (already Cmd+K-reachable everywhere) is this route's
//    way back to every other page instead.
//  - inbox-zero's blue circular button toggles an embedded assistant
//    slide-over panel in place. imap-ai has no such panel -- building one
//    would mean duplicating the chat UI, a bigger scope than a layout
//    match. This is a real link to the existing /chat page instead, kept
//    functional rather than a decorative control that does nothing.
export default function MailLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            i
          </div>
          <span className="font-semibold">imap-ai</span>
        </Link>
        <div className="flex-1" />
        <CommandPaletteTrigger />
        <ThemeToggleButton />
      </header>
      <div className="relative flex-1 overflow-auto">
        {children}
        <Link
          href="/chat"
          className="fixed bottom-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105"
          aria-label="Open the assistant"
        >
          <Sparkles className="h-5 w-5" />
        </Link>
      </div>
    </div>
  );
}
