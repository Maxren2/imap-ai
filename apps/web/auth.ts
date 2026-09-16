import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@imap-ai/core/db";
import { authConfig } from "./auth.config";

// JWT session strategy, no Prisma adapter -- Auth.js's own adapter/Account/
// Session tables aren't needed (and its Account model would collide by
// name with this project's own EmailAccount concept, see DESIGN.md's
// multi-user section). A password is the only sign-in method; linking a
// Gmail/Outlook/IMAP mailbox is a separate flow under /add-account, not
// handled by Auth.js at all.
//
// This file (with the real, Prisma-dependent Credentials provider) is for
// route handlers/Server Components/Server Actions only -- middleware.ts
// imports the Prisma-free auth.config.ts instead, since Edge middleware
// can't load Prisma's native bindings (confirmed live: bundling this
// module into middleware crashed every page with "Cannot read properties
// of undefined (reading 'exec')" from Prisma's generated runtime).
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    // The default JWT/session callbacks drop custom fields -- thread the
    // user id and role through explicitly so requireUser()/requireAdmin()
    // (lib/session.ts) can read them without a second DB lookup keyed only
    // by email. Note: a role change made via /admin/users doesn't take
    // effect for an already-signed-in session until it next signs in (the
    // JWT isn't re-derived from the database on every request) -- a stale
    // read here, not a stale write; the database row itself is always
    // correct immediately.
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role ?? "user";
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as string) ?? "user";
      }
      return session;
    },
  },
});
