"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Search, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { navItems } from "@/components/app-sidebar";

// inbox-zero has a real Cmd+K palette (components/CommandK.tsx, per
// DESIGN.md section 33 item 2) -- this mirrors that pattern using the
// shadcn `Command`/`cmdk` primitives already scaffolded but unused until
// now. Items are navigation plus the same dark-mode toggle already in the
// sidebar footer, not new capabilities.
//
// Split into a Provider (mounted once at the root, owns state/shortcut/
// dialog) and a Trigger (a plain button any header can render) because the
// sidebar-less Mail layout and the regular sidebar layout each need their
// own visible trigger button while sharing one dialog and one Cmd+K
// listener -- rendering the whole thing twice would double up both.
const CommandPaletteContext = createContext<{ open: () => void } | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const runAndClose = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to a page or run a command..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigate">
            {navItems
              .filter((item) => !item.soon)
              .map((item) => (
                <CommandItem
                  key={item.href}
                  value={item.title}
                  onSelect={() => runAndClose(() => router.push(item.href))}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Appearance">
            <CommandItem value="Light mode" onSelect={() => runAndClose(() => setTheme("light"))}>
              <Sun />
              <span>Light mode</span>
            </CommandItem>
            <CommandItem value="Dark mode" onSelect={() => runAndClose(() => setTheme("dark"))}>
              <Moon />
              <span>Dark mode</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}

function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within a CommandPaletteProvider");
  return ctx;
}

export function CommandPaletteTrigger() {
  const { open } = useCommandPalette();

  // navigator.platform is only known client-side -- reading it during the
  // initial render would render "Ctrl" on the server and possibly "⌘" after
  // hydration on a Mac, the same SSR/CSR mismatch class as the locale bug in
  // feedback_locale_formatting_hydration_mismatch.md. Default to "Ctrl" for
  // both the server render and the first client render, then correct after
  // mount once it's safe to diverge.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  return (
    <Button variant="outline" size="sm" className="h-8 gap-2 text-muted-foreground" onClick={open}>
      <Search className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="pointer-events-none hidden select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] sm:flex">
        {isMac ? "⌘" : "Ctrl"}K
      </kbd>
    </Button>
  );
}
