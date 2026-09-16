"use server";

import { prisma } from "@imap-ai/core/db";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";

/**
 * Promotes/demotes another user. Refuses to demote the acting admin if
 * they're the last one -- otherwise a single click could leave the app
 * with zero admins and no way to grant the role back short of a direct
 * database edit.
 */
export async function setUserRole(userId: string, role: "admin" | "user"): Promise<void> {
  const admin = await requireAdmin();

  if (role === "user" && userId === admin.id) {
    const adminCount = await prisma.user.count({ where: { role: "admin" } });
    if (adminCount <= 1) {
      throw new Error("You're the only admin -- promote someone else first before demoting yourself.");
    }
  }

  await prisma.user.update({ where: { id: userId }, data: { role } });
  revalidatePath("/admin/users");
}

/**
 * Deletes a user and everything under them (EmailAccount -> Mailbox/
 * Message/Rule/Chat, all Cascade in schema.prisma) -- this app's local
 * mirror and configuration only, never the real mailbox on the mail
 * server itself. A real, hard-to-reverse loss of local data (synced
 * history, rules, chat threads), so the UI (DeleteUserButton) requires
 * typing the target's email before this can even be called with the
 * right id. Refuses to delete yourself -- always leave at least the
 * acting admin able to sign back in.
 */
export async function deleteUser(userId: string): Promise<void> {
  const admin = await requireAdmin();
  if (userId === admin.id) {
    throw new Error("You can't delete your own account from here.");
  }

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath("/admin/users");
}
