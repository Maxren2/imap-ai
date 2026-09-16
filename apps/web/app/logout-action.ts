"use server";

import { signOut } from "@/auth";

export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
