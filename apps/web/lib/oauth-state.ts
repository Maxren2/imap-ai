import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Minimal CSRF protection for the account-linking OAuth flows (Google/
 * Microsoft): a random nonce stored in a short-lived httpOnly cookie
 * before redirecting to the provider, compared against the `state` query
 * param the provider echoes back on the callback. No database round-trip
 * needed -- the cookie itself is the store, scoped to this one flow.
 */
export async function createOAuthState(cookieName: string): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(cookieName, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return state;
}

export async function verifyOAuthState(cookieName: string, receivedState: string | null): Promise<boolean> {
  const cookieStore = await cookies();
  const expected = cookieStore.get(cookieName)?.value;
  cookieStore.delete(cookieName);
  return !!expected && !!receivedState && expected === receivedState;
}
