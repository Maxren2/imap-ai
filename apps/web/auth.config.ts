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
  // Auth.js v5 rejects requests whose Host header it doesn't already trust
  // by default -- fine running bare (host === the port you connected to),
  // but any reverse proxy in front of the app (TrueNAS's app ingress
  // included) forwards a different Host than the container's own
  // 127.0.0.1:<port>, which Auth.js then refuses with UntrustedHost rather
  // than silently misbehaving. This app has no way to know its final
  // public origin ahead of time (self-hosted, deployed behind whatever
  // proxy/domain the operator points at it), so there's no fixed AUTH_URL
  // to pin -- trusting the incoming Host is the documented fix for
  // exactly this deployment shape. Confirmed live: TrueNAS deployment
  // failed every request with this exact error until this was added.
  trustHost: true,
} satisfies NextAuthConfig;
