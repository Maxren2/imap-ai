import "../env.js";
import { prisma } from "../db.js";
import { resolveAccounts } from "../account-scope.js";
import type { RuleConditions } from "./types.js";

/**
 * Creates a couple of example rules against every linked account (or just
 * one via ACCOUNT_ID/--account, see account-scope.ts), so the rules engine
 * has something real to match before there's a UI to create rules through.
 * Safe to re-run: upserts by name.
 */
async function main() {
  const accounts = await resolveAccounts();
  if (accounts.length === 0) {
    console.log("No linked accounts.");
    return;
  }

  const rules: { name: string; conditions?: RuleConditions; aiPrompt?: string }[] = [
    {
      name: "GitHub notifications",
      conditions: [{ field: "fromAddress", operator: "contains", value: "notifications@github.com" }],
    },
    {
      name: "Sent by me",
      conditions: [{ field: "labels", operator: "contains", value: "\\Sent" }],
    },
    {
      name: "Security alert (AI)",
      aiPrompt:
        "The email is a security alert or warning from a service about a new sign-in, device, or app getting access to my account.",
    },
  ];

  for (const account of accounts) {
    for (const { name, conditions, aiPrompt } of rules) {
      await prisma.rule.upsert({
        where: { accountId_name: { accountId: account.id, name } },
        update: { conditions, aiPrompt },
        create: { accountId: account.id, name, conditions, aiPrompt },
      });
      console.log(`[${account.email}] Upserted rule "${name}".`);
    }
  }
}

main()
  .catch((error) => {
    console.error("rules:seed-example failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
