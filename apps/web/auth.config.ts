import type { NextAuthConfig } from "next-auth";

// Split out from auth.ts specifically so middleware.ts can import just
// this -- it runs on the Edge runtime, which can't load Prisma's native
// bindings. auth.ts's Credentials provider (and everything it pulls in --
// bcrypt, @imap-ai/core/db) is Node-only; this config has no providers at
// all, so a NextAuth instance built from it can still decode/verify the
// session JWT (all that needs is AUTH_SECRET) without ever touching the
// database. The real provider is added in auth.ts, used everywhere except
// middleware.
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
} satisfies NextAuthConfig;
