import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { CommandPaletteProvider } from "@/components/command-palette";
import { auth } from "@/auth";

// Matches inbox-zero's real typography (confirmed from its source) --
// imap-ai's globals.css previously fell back to the browser default system
// font entirely, no font import at all.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata = {
  title: "imap-ai",
};

// Bare shell only -- the sidebar chrome (SidebarProvider/AppSidebar/header)
// moved to (app)/layout.tsx, since the (mail) route group's Inbox now has
// its own distinct, sidebar-less layout instead. CommandPaletteProvider
// lives here so Cmd+K and its dialog work from either group; each group's
// own layout renders its own <CommandPaletteTrigger /> button.
export default async function RootLayout({ children }: { children: ReactNode }) {
  // Session decode only (no DB call, see auth.config.ts) -- safe to read
  // on every page including public ones (/login, /signup), where it's
  // simply null. Only used here to filter the "Users" admin nav item out
  // of the command palette for non-admins (app-sidebar.tsx does the same
  // for the actual sidebar link, both redundant with requireAdmin()'s own
  // server-side redirect on the page itself -- this is a UX nicety, not
  // the real access boundary).
  const session = await auth();

  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <CommandPaletteProvider isAdmin={session?.user?.role === "admin"}>{children}</CommandPaletteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
