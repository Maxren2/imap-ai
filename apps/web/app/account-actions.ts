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

export async function removeAccount(accountId: string): Promise<void> {
  const user = await requireUser();
  await prisma.emailAccount.deleteMany({ where: { id: accountId, userId: user.id } });

  const cookieStore = await cookies();
  if (cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value === accountId) {
    cookieStore.delete(ACTIVE_ACCOUNT_COOKIE);
  }
  redirect("/");
}
