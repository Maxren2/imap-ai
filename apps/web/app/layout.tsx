import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "imap-ai",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <span className="nav-brand">imap-ai</span>
          <a href="/">Home</a>
          <a href="/rules">Rules</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
