"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@imap-ai/core/db";
import { signIn } from "@/auth";

export interface FormState {
  error?: string;
}

export async function signup(_prevState: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const passwordHash = await bcrypt.hash(password, 12);
  // The very first person to ever sign up becomes admin automatically --
  // self-signup stays open (no invite wall, see DESIGN.md's multi-user
  // section on why), but someone needs to be able to manage other users
  // once more than one exists. A race between two simultaneous first
  // signups could in theory both read count 0 and both become admin --
  // acceptable for this self-hosted, single-operator tool; not guarded
  // with a transaction/lock given how unlikely and low-stakes that is here.
  const isFirstUser = (await prisma.user.count()) === 0;
  await prisma.user.create({ data: { email, passwordHash, role: isFirstUser ? "admin" : "user" } });

  try {
    await signIn("credentials", { email, password, redirectTo: "/add-account" });
  } catch (error) {
    // signIn's own successful-redirect is also implemented as a thrown
    // "NEXT_REDIRECT" error -- only a genuine AuthError means sign-in
    // itself failed (shouldn't happen right after creating the user with
    // this same password, but fail loudly rather than silently if it
    // somehow does).
    if (error instanceof AuthError) return { error: "Account created, but sign-in failed. Try logging in." };
    throw error;
  }
  return {};
}
