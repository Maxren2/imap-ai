"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@imap-ai/core/db";
import { ACTIVE_ACCOUNT_COOKIE, requireUser } from "@/lib/session";

/** Switches which linked mailbox subsequent pages read -- see lib/session.ts's getActiveEmailAccount(). */
export async function setActiveAccount(accountId: string): Promise<void> {
  const user = await requireUser();
  // Verify ownership before trusting this id into the cookie -- otherwise
  // a crafted accountId would let one user "switch into" another user's
  // mailbox.
  const account = await prisma.emailAccount.findFirst({ where: { id: accountId, userId: user.id } });
  if (!account) throw new Error("Account not found.");

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ACCOUNT_COOKIE, accountId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}

/**
 * Deletes one linked mailbox and everything under it (Mailbox/Message/
 * Rule/Chat, all Cascade in schema.prisma) -- this app's local mirror for
 * that one inbox only, never the real mailbox on the mail server, and
 * never the signed-in User itself. `deleteMany` never throws for "no
 * matching row" on its own (it would silently delete zero rows for an
 * accountId belonging to a different user, or one that's already gone),
 * so the count is checked explicitly -- the caller (RemoveAccountButton)
 * needs a real thrown error to distinguish "genuinely failed" from
 * "succeeded and redirected".
 */
export async function removeAccount(accountId: string): Promise<void> {
  const user = await requireUser();
  const { count } = await prisma.emailAccount.deleteMany({ where: { id: accountId, userId: user.id } });
  if (count === 0) {
    throw new Error("Mailbox not found.");
  }

  const cookieStore = await cookies();
  if (cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value === accountId) {
    cookieStore.delete(ACTIVE_ACCOUNT_COOKIE);
  }
  redirect("/");
}
