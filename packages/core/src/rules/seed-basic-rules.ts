import "../env.js";
import { prisma } from "../db.js";
import type { RuleActions } from "./actions.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * A handful of common inbox-cleanup rules, structurally inspired by
 * inbox-zero's default rule categories (apps/web/utils/rule/consts.ts:
 * Newsletter, Marketing, Receipt, Notification, among others) -- same
 * shape (AI-prompt match, label + archive), rewritten fresh for this
 * project's own schema rather than ported. Prompt wording is original,
 * not copied from inbox-zero's source. Safe to re-run: upserts by name.
 * All disabled by default so nothing gets auto-archived until you've
 * reviewed what they'd catch.
 */
async function main() {
  const account = await prisma.account.findUniqueOrThrow({ where: { email: requireEnv("GMAIL_ADDRESS") } });

  const rules: { name: string; aiPrompt: string; actions: RuleActions }[] = [
    {
      name: "Newsletter",
      aiPrompt:
        "The email is a newsletter or subscribed content digest (a recurring publication you opted into), not a one-off personal or transactional message.",
      actions: [{ type: "label", label: "Newsletter" }, { type: "archive" }],
    },
    {
      name: "Marketing",
      aiPrompt:
        "The email is a promotional or marketing message -- a sale, discount, product announcement, or ad -- and not something that requires account action, a purchase confirmation, or a service update.",
      actions: [{ type: "label", label: "Marketing" }, { type: "archive" }],
    },
    {
      name: "Receipt",
      aiPrompt:
        "The email is a purchase receipt, invoice, or payment confirmation for something already bought or paid.",
      actions: [{ type: "label", label: "Receipt" }],
    },
    {
      name: "Notification",
      aiPrompt:
        "The email is an automated notification from a service or platform (e.g. a status update, activity alert, or system message) that doesn't need a reply.",
      actions: [{ type: "label", label: "Notification" }, { type: "archive" }],
    },
  ];

  for (const { name, aiPrompt, actions } of rules) {
    await prisma.rule.upsert({
      where: { accountId_name: { accountId: account.id, name } },
      update: { aiPrompt, actions, enabled: false },
      create: { accountId: account.id, name, aiPrompt, actions, enabled: false },
    });
    console.log(`Upserted rule "${name}" (disabled -- enable it once you've reviewed what it'd catch).`);
  }
}

main()
  .catch((error) => {
    console.error("rules:seed-basic failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
