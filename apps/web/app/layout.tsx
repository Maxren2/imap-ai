import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { CommandPaletteProvider } from "@/components/command-palette";

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
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <CommandPaletteProvider>{children}</CommandPaletteProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
