"use server";

import { prisma } from "@imap-ai/core/db";
import { connectImap, requireEnv } from "@imap-ai/core/imap-connect";
import { ensureMessageBody } from "@imap-ai/core/body";
import { resolveOllamaConfig, evaluateAiPrompt } from "@imap-ai/core/ai/ollama";
import { revalidatePath } from "next/cache";

/**
 * Creates the Cold Email Blocker rule on first visit, same as
 * `npm run rules:seed-cold-email`. Returns void (not the created rule) so
 * this can be passed directly as a <form action={...}> -- Next.js requires
 * a form action to resolve to void.
 */
export async function setUpColdEmailBlocker(): Promise<void> {
  const account = await prisma.account.findFirstOrThrow();

  const existing = await prisma.rule.findUnique({
    where: { accountId_systemType: { accountId: account.id, systemType: "COLD_EMAIL" } },
  });
  if (existing) {
    revalidatePath("/cold-email-blocker");
    return;
  }

  await prisma.rule.create({
    data: {
      accountId: account.id,
      name: "Cold Email Blocker",
      systemType: "COLD_EMAIL",
      enabled: true,
      aiPrompt:
        "The email is unsolicited outreach from a sender the recipient has no prior relationship with, trying to sell something, pitch a partnership, recruit, or ask for a favor -- the kind of message a stranger sends hoping to start a conversation for their own benefit. " +
        "This is NOT a cold email if it's a reply in an existing conversation, from a known contact/colleague/friend, a newsletter or subscribed content, a receipt or transactional message, an automated notification, a calendar invite, or a customer support reply to something the recipient initiated.",
    },
  });
  revalidatePath("/cold-email-blocker");
}

/**
 * Remembers a sender as not-cold, matching inbox-zero's per-sender
 * "learned pattern" behavior (not a one-off list dismissal): future
 * messages from this sender are excluded from the Cold Emails list going
 * forward too (see queries.ts's getColdEmails).
 */
export async function markNotCold(fromAddress: string): Promise<void> {
  const account = await prisma.account.findFirstOrThrow();
  await prisma.coldEmailException.upsert({
    where: { accountId_senderAddress: { accountId: account.id, senderAddress: fromAddress } },
    update: {},
    create: { accountId: account.id, senderAddress: fromAddress },
  });
  revalidatePath("/cold-email-blocker");
}

export async function unmarkNotCold(fromAddress: string): Promise<void> {
  const account = await prisma.account.findFirstOrThrow();
  await prisma.coldEmailException.deleteMany({ where: { accountId: account.id, senderAddress: fromAddress } });
  revalidatePath("/cold-email-blocker");
}

export interface TestResult {
  coldEmail: boolean;
}

/** Runs the cold-email prompt against one real message, on demand -- doesn't record a match either way. */
export async function testColdEmail(messageId: string): Promise<TestResult> {
  const rule = await prisma.rule.findFirst({ where: { systemType: "COLD_EMAIL" } });
  if (!rule?.aiPrompt) throw new Error("Cold Email Blocker isn't set up yet.");

  const ollamaConfig = resolveOllamaConfig();
  if (!ollamaConfig) throw new Error("OLLAMA_BASE_URL/OLLAMA_MODEL aren't configured.");

  const message = await prisma.message.findUniqueOrThrow({
    where: { id: messageId },
    select: { id: true, uid: true, subject: true, fromAddress: true, fromName: true, bodyText: true, bodyFetchedAt: true },
  });

  const gmailAddress = requireEnv("GMAIL_ADDRESS");
  const client = await connectImap(gmailAddress);
  const lock = await client.getMailboxLock("INBOX");
  let body: string | null;
  try {
    body = await ensureMessageBody(client, message);
  } finally {
    lock.release();
    await client.logout();
  }

  const coldEmail = await evaluateAiPrompt(ollamaConfig, {
    prompt: rule.aiPrompt,
    subject: message.subject,
    fromAddress: message.fromAddress,
    fromName: message.fromName,
    body,
  });
  return { coldEmail };
}
