import { prisma } from "./db";
import type { EmailAccount } from "./generated/prisma/index.js";

/**
 * Resolves which accounts a CLI script (sync/watch/backfill/rules:run/etc.)
 * should operate on. Every one of these scripts used to implicitly mean
 * "the one account from GMAIL_ADDRESS" -- now they loop over every linked
 * EmailAccount by default, or just one when scoped to a specific account
 * (the web UI's per-account "run now" buttons pass this so a button on one
 * person's Rules page doesn't also run every other user's rules).
 *
 * Reads ACCOUNT_ID from the environment first, not argv -- background-run.ts's
 * own comment documents why: its spawn goes through two layers of `npm run`
 * delegation (repo root -> the @imap-ai/core workspace), and argv doesn't
 * reliably survive both hops, while env vars do (same reasoning Deep
 * Clean's options already rely on). `--account <id>` on argv is also
 * checked, as a convenience for running a script by hand directly (a
 * single `npm run <script> -- --account <id>` has no such delegation
 * problem).
 */
export async function resolveAccounts(argv: string[] = process.argv.slice(2)): Promise<EmailAccount[]> {
  const flagIndex = argv.indexOf("--account");
  const accountId = process.env.ACCOUNT_ID || (flagIndex !== -1 ? argv[flagIndex + 1] : undefined);

  if (accountId) {
    const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new Error(`No EmailAccount found with id ${accountId}`);
    return [account];
  }

  return prisma.emailAccount.findMany({ orderBy: { createdAt: "asc" } });
}
