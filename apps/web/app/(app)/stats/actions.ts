"use server";

import { prisma } from "@imap-ai/core/db";
import { revalidatePath } from "next/cache";
import { SENDER_CATEGORIES, type SenderCategory } from "@/lib/analytics/categorize-sender";
import { getActiveEmailAccount } from "@/lib/session";

/**
 * Persists a hand-correction to the heuristic categorizer's guess for one
 * sender (see lib/analytics/categorize-sender.ts's documented known gap --
 * English-only keyword patterns miss e.g. German/French receipt mail). The
 * override always wins over the heuristic afterward, in both the breakdown
 * chart and this table (see queries.ts's getOverridesMap).
 */
export async function setSenderCategory(fromAddress: string, category: SenderCategory): Promise<void> {
  if (!SENDER_CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}`);
  }
  const account = await getActiveEmailAccount();
  await prisma.senderCategoryOverride.upsert({
    where: { accountId_senderAddress: { accountId: account.id, senderAddress: fromAddress } },
    update: { category },
    create: { accountId: account.id, senderAddress: fromAddress, category },
  });
  revalidatePath("/stats");
}
