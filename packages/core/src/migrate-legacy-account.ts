import "./env.js";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";
import { encryptSecret } from "./crypto.js";
import { requireEnv } from "./imap-connect.js";

/**
 * One-time upgrade path for anyone who set up imap-ai before multi-user
 * auth existed: the schema migration (see prisma/migrations/*_multi_user_auth)
 * renamed the old single Account row to EmailAccount and left it with a
 * NULL userId rather than deleting it, specifically so this script could
 * re-parent it to a real User instead of losing the already-synced mail
 * history (Mailbox/Message/Rule/Chat rows all cascade off EmailAccount.id,
 * which doesn't change here). Takes the new login's email/password via
 * MIGRATE_LOGIN_EMAIL/MIGRATE_LOGIN_PASSWORD env vars rather than an
 * interactive prompt -- simpler to script/re-run reliably, same reasoning
 * as Deep Clean's own env-var options. Imports GOOGLE_REFRESH_TOKEN from
 * .env into encrypted storage so the account doesn't need to be
 * re-authorized via the new "Connect Gmail" flow from scratch. Safe to run
 * more than once: a no-op once no rows are left with a NULL userId.
 */
async function main() {
  const orphaned = await prisma.$queryRaw<{ id: string; email: string; provider: string }[]>`
    SELECT id, email, provider FROM "EmailAccount" WHERE "userId" IS NULL
  `;

  if (orphaned.length === 0) {
    console.log("Nothing to migrate -- no pre-multi-user EmailAccount rows found.");
    return;
  }

  console.log(`Found ${orphaned.length} account(s) from before multi-user support: ${orphaned.map((a) => a.email).join(", ")}`);

  const email = process.env.MIGRATE_LOGIN_EMAIL?.trim();
  const password = process.env.MIGRATE_LOGIN_PASSWORD;

  if (!email || !password || password.length < 8) {
    throw new Error(
      "Set MIGRATE_LOGIN_EMAIL and MIGRATE_LOGIN_PASSWORD (8+ chars) env vars -- these become your login for the web app.",
    );
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error(`A user with email ${email} already exists -- use the web app to link accounts to that login instead.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  // This script only ever creates the very first user of a fresh
  // multi-user upgrade -- same "first user becomes admin" rule as regular
  // signup (apps/web/app/signup/actions.ts), applied explicitly here
  // since this path bypasses that server action entirely.
  const user = await prisma.user.create({ data: { email, passwordHash, role: "admin" } });
  console.log(`Created user ${user.email} (admin).`);

  for (const account of orphaned) {
    const data: { userId: string; oauthRefreshTokenEnc?: string } = { userId: user.id };

    if (account.provider === "gmail") {
      const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
      if (refreshToken) {
        data.oauthRefreshTokenEnc = encryptSecret(requireEnv("GOOGLE_REFRESH_TOKEN"));
        console.log(`  Imported GOOGLE_REFRESH_TOKEN for ${account.email} into encrypted storage.`);
      } else {
        console.warn(
          `  No GOOGLE_REFRESH_TOKEN in .env -- ${account.email} will need to be re-connected via "Connect Gmail" in the app before sync/rules work again.`,
        );
      }
    }

    await prisma.emailAccount.update({ where: { id: account.id }, data });
    console.log(`  Linked ${account.email} to ${user.email}.`);
  }

  console.log(
    "\nDone. Log in at /login with the credentials you just set, then remove GMAIL_ADDRESS/GOOGLE_REFRESH_TOKEN from .env if you like -- they're not read at runtime anymore.",
  );
}

main()
  .catch((error) => {
    console.error("migrate-legacy-account failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
