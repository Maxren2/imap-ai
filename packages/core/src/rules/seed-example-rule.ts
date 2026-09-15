import "../env.js";
import { prisma } from "../db.js";
import type { RuleConditions } from "./types.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

/**
 * Creates a couple of example rules against the account already synced by
 * `npm run sync`, so the rules engine has something real to match before
 * there's a UI to create rules through. Safe to re-run: upserts by name.
 */
async function main() {
  const account = await prisma.account.findUniqueOrThrow({ where: { email: requireEnv("GMAIL_ADDRESS") } });

  const rules: { name: string; conditions: RuleConditions }[] = [
    {
      name: "GitHub notifications",
      conditions: [{ field: "fromAddress", operator: "contains", value: "notifications@github.com" }],
    },
    {
      name: "Sent by me",
      conditions: [{ field: "labels", operator: "contains", value: "\\Sent" }],
    },
  ];

  for (const { name, conditions } of rules) {
    await prisma.rule.upsert({
      where: { accountId_name: { accountId: account.id, name } },
      update: { conditions },
      create: { accountId: account.id, name, conditions },
    });
    console.log(`Upserted rule "${name}".`);
  }
}

main()
  .catch((error) => {
    console.error("rules:seed-example failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
