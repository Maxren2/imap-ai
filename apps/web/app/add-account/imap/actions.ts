"use server";

import { encryptSecret } from "@imap-ai/core/crypto";
import { connectAccountImap } from "@imap-ai/core/mail-provider";
import { prisma } from "@imap-ai/core/db";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { onAccountLinked } from "@/lib/account-linked";

export interface FormState {
  error?: string;
}

export async function addImapAccount(_prevState: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const email = String(formData.get("email") ?? "").trim();
  const imapHost = String(formData.get("imapHost") ?? "").trim();
  const imapPort = Number(formData.get("imapPort") ?? 993);
  const imapUser = String(formData.get("imapUser") ?? "").trim() || email;
  const password = String(formData.get("password") ?? "");
  const smtpHost = String(formData.get("smtpHost") ?? "").trim() || undefined;
  const smtpPort = formData.get("smtpPort") ? Number(formData.get("smtpPort")) : undefined;

  if (!email || !imapHost || !password) {
    return { error: "Email, IMAP host, and password are required." };
  }
  if (!Number.isFinite(imapPort) || imapPort <= 0) {
    return { error: "IMAP port must be a positive number." };
  }

  // Test-connect with the real, plaintext values BEFORE encrypting and
  // saving anything -- a bad password should fail loudly here, not surface
  // later as a mysterious sync failure.
  try {
    const client = await connectAccountImap({
      provider: "imap",
      email,
      imapHost,
      imapPort,
      imapUser,
      imapPasswordEnc: encryptSecret(password),
      oauthRefreshTokenEnc: null,
    });
    await client.logout();
  } catch (error) {
    return { error: `Could not connect: ${error instanceof Error ? error.message : String(error)}` };
  }

  const existing = await prisma.emailAccount.findUnique({ where: { userId_email: { userId: user.id, email } } });
  const account = await prisma.emailAccount.upsert({
    where: { userId_email: { userId: user.id, email } },
    update: {
      provider: "imap",
      imapHost,
      imapPort,
      imapUser,
      imapPasswordEnc: encryptSecret(password),
      smtpHost,
      smtpPort,
    },
    create: {
      userId: user.id,
      email,
      provider: "imap",
      imapHost,
      imapPort,
      imapUser,
      imapPasswordEnc: encryptSecret(password),
      smtpHost,
      smtpPort,
    },
  });

  // See the matching comment in api/connect/google/callback/route.ts.
  await onAccountLinked(account.id, !existing);

  redirect("/");
}
