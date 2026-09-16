import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@imap-ai/core/db";
import { auth } from "@/auth";

export const ACTIVE_ACCOUNT_COOKIE = "activeAccountId";

/**
 * Every Server Component/Action that needs to know who's signed in calls
 * this rather than trusting middleware alone -- middleware.ts covers the
 * common case (redirect before the page even renders), but Server Actions
 * and anything reached outside the matcher shouldn't assume it always ran.
 */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

/**
 * Same as requireUser(), plus an admin check -- the only authorization
 * tier this app has (see schema.prisma's User.role comment). Redirects
 * non-admins to the Inbox rather than showing a bare 403, consistent with
 * how the rest of the app redirects instead of erroring on an
 * access-boundary miss (e.g. getActiveEmailAccount's account-not-found
 * case). The role comes from the session JWT (set at sign-in), not a
 * fresh database read -- see auth.ts's callbacks comment on why a role
 * change doesn't apply retroactively to an already-signed-in session.
 */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * Resolves which of the signed-in user's linked mailboxes is "active" --
 * the account-scoped equivalent of the old `prisma.account.findFirst()`
 * every query used to do. Reads the activeAccountId cookie (set by the
 * account switcher, see components/account-switcher.tsx), falls back to
 * the user's oldest linked account, and sends the user to link one at all
 * if they have none yet.
 */
export async function getActiveEmailAccount() {
  const user = await requireUser();

  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_ACCOUNT_COOKIE)?.value;

  if (activeId) {
    // Scoped by userId, not just id -- this is the actual boundary that
    // stops one user from reading another's mailbox by guessing/reusing a
    // cookie value for an account they don't own.
    const account = await prisma.emailAccount.findFirst({ where: { id: activeId, userId: user.id } });
    if (account) return account;
  }

  const fallback = await prisma.emailAccount.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  if (!fallback) redirect("/add-account");
  return fallback;
}

export async function listEmailAccounts() {
  const user = await requireUser();
  return prisma.emailAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
}
