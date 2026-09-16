"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export interface FormState {
  error?: string;
}

export async function login(_prevState: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/");

  try {
    await signIn("credentials", { email, password, redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) return { error: "Invalid email or password." };
    throw error; // the successful-sign-in redirect is also thrown -- let it propagate
  }
  return {};
}
