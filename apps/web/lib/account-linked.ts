import { runNpmScript } from "./background-run";

/**
 * Called right after an EmailAccount is created or re-linked, from all
 * three connect flows (Gmail, Outlook, IMAP) -- one shared place instead
 * of three slightly-different copies of "what happens after linking".
 */
export async function onAccountLinked(accountId: string, isNewAccount: boolean): Promise<void> {
  // Sync is always safe to re-run (its own UID cursor only fetches what's
  // new), and nothing else ever runs it automatically -- without this, a
  // freshly-linked mailbox has no way to ever populate its inbox short of
  // someone running `npm run sync` by hand inside the container.
  await runNpmScript("sync", "sync", "/", accountId);

  // Only on a genuine first link -- rules:seed-basic upserts its rules by
  // name and *always* resets `enabled` back to false on its update branch
  // (deliberately, for a first seed: nothing should auto-archive before
  // it's been reviewed). Re-running it against an already-linked account
  // (e.g. reconnecting after a revoked/expired token) would silently
  // disable any of these default rules the user had since turned on
  // themselves -- a real, surprising loss of their own configuration.
  if (isNewAccount) {
    await runNpmScript("rules:seed-basic", "rules:seed-basic", "/rules", accountId);
  }
}
