import { prisma } from "@imap-ai/core/db";
import { getActiveEmailAccount } from "@/lib/session";

export async function getColdEmailRule() {
  const account = await getActiveEmailAccount();
  return prisma.rule.findUnique({
    where: { accountId_systemType: { accountId: account.id, systemType: "COLD_EMAIL" } },
  });
}

export interface ColdEmailRow {
  messageId: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  dateIso: string;
}

/**
 * Messages the cold-email rule has matched, most recent first, minus
 * senders the user has explicitly marked not-cold -- a plain Prisma query
 * (not raw SQL), so this doesn't need the backslash-escaping care that
 * $queryRaw label/flag comparisons do (see stats/queries.ts).
 */
export async function getColdEmails(ruleId: string, limit = 50): Promise<ColdEmailRow[]> {
  // ColdEmailException isn't scoped by rule (there's only ever one
  // cold-email rule per account), so look it up by account instead.
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id: ruleId }, select: { accountId: true } });
  const exceptions = await prisma.coldEmailException.findMany({
    where: { accountId: rule.accountId },
    select: { senderAddress: true },
  });
  const excludedAddresses = exceptions.map((e) => e.senderAddress);

  const matches = await prisma.ruleMatch.findMany({
    where: {
      ruleId,
      message: excludedAddresses.length > 0 ? { fromAddress: { notIn: excludedAddresses } } : {},
    },
    orderBy: { message: { date: "desc" } },
    take: limit,
    select: {
      message: { select: { id: true, fromAddress: true, fromName: true, subject: true, date: true } },
    },
  });

  return matches.map((m) => ({
    messageId: m.message.id,
    fromAddress: m.message.fromAddress,
    fromName: m.message.fromName,
    subject: m.message.subject,
    dateIso: m.message.date.toISOString(),
  }));
}

export interface NotColdSender {
  senderAddress: string;
  markedAtIso: string;
}

export async function getNotColdSenders(accountId: string): Promise<NotColdSender[]> {
  const rows = await prisma.coldEmailException.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({ senderAddress: row.senderAddress, markedAtIso: row.createdAt.toISOString() }));
}

export interface RecentMessageRow {
  id: string;
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  dateIso: string;
}

/** For the Test tab -- pick a real recent message to preview the AI verdict on. */
export async function getRecentInboxMessages(limit = 20): Promise<RecentMessageRow[]> {
  const account = await getActiveEmailAccount();
  const messages = await prisma.message.findMany({
    where: { inInbox: true, mailbox: { accountId: account.id } },
    orderBy: { date: "desc" },
    take: limit,
    select: { id: true, fromAddress: true, fromName: true, subject: true, date: true },
  });
  return messages.map((m) => ({
    id: m.id,
    fromAddress: m.fromAddress,
    fromName: m.fromName,
    subject: m.subject,
    dateIso: m.date.toISOString(),
  }));
}
