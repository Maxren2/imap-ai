import "../env.js";
import { prisma } from "../db.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Original wording, inspired by the concept of "cold outreach" rather
// than copied from any specific source -- an unsolicited message from
// someone with no prior relationship to the recipient, sent to get
// something from them (sell, pitch, recruit, ask for a favor) rather
// than because the recipient asked for or expected it. Deliberately
// excludes newsletters/receipts/notifications/alerts, which already have
// their own rules (see seed-basic-rules.ts) and aren't "cold outreach"
// in this sense even though they're also unsolicited in a loose sense.
const COLD_EMAIL_PROMPT =
  "The email is unsolicited outreach from a sender the recipient has no prior relationship with, trying to sell something, pitch a partnership, recruit, or ask for a favor -- the kind of message a stranger sends hoping to start a conversation for their own benefit. " +
  "This is NOT a cold email if it's a reply in an existing conversation, from a known contact/colleague/friend, a newsletter or subscribed content, a receipt or transactional message, an automated notification, a calendar invite, or a customer support reply to something the recipient initiated.";

/**
 * Creates the Cold Email Blocker's rule if it doesn't already exist
 * (found by Rule.systemType = "COLD_EMAIL", not by name, so renaming it
 * later doesn't break the feature). No actions attached by default --
 * matches inbox-zero's "list only" mode, the safe default: nothing gets
 * archived/labeled automatically until the user attaches actions via the
 * normal rule editor at /rules/[id]/edit. Safe to re-run.
 */
async function main() {
  const account = await prisma.account.findUniqueOrThrow({ where: { email: requireEnv("GMAIL_ADDRESS") } });

  const existing = await prisma.rule.findUnique({
    where: { accountId_systemType: { accountId: account.id, systemType: "COLD_EMAIL" } },
  });
  if (existing) {
    console.log(`Cold Email Blocker rule already exists ("${existing.name}"), leaving it as-is.`);
    return;
  }

  const rule = await prisma.rule.create({
    data: {
      accountId: account.id,
      name: "Cold Email Blocker",
      systemType: "COLD_EMAIL",
      enabled: true,
      aiPrompt: COLD_EMAIL_PROMPT,
    },
  });
  console.log(`Created Cold Email Blocker rule "${rule.name}" (no actions attached -- detection only for now).`);
}

main()
  .catch((error) => {
    console.error("rules:seed-cold-email failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
