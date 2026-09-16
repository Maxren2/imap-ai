import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Uses the Prisma-free auth.config.ts, not the full auth.ts -- middleware
// runs on the Edge runtime, which can't load Prisma's native bindings.
// This only checks for a valid session JWT (decoded from the cookie, no DB
// hit); "does this user have any linked EmailAccount yet" is checked
// separately in lib/session.ts's getActiveEmailAccount(), inside actual
// Server Components instead.
const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;
  const isPublicRoute = pathname === "/login" || pathname === "/signup" || pathname.startsWith("/api/auth");

  if (!isLoggedIn && !isPublicRoute) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (isLoggedIn && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
});

export const config = {
  // Everything except static assets and the Next.js internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
