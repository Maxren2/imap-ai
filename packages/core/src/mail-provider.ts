import { ImapFlow, type ImapFlowOptions } from "imapflow";
import nodemailer, { type Transporter } from "nodemailer";
import { getGmailAccessToken } from "./gmail-oauth";
import { getMicrosoftAccessToken } from "./microsoft-oauth";
import { decryptSecret } from "./crypto";
import { resolveOAuthConfig } from "./instance-config";
import type { EmailAccount } from "./generated/prisma/index.js";

export type ProviderKind = "gmail" | "outlook" | "imap";

// Structural subset of EmailAccount, not the full Prisma row -- lets
// callers that don't have (or don't want) a real database row, like the
// "test this connection before saving it" step in the add-IMAP-account
// form, pass just the fields that actually matter here instead of
// fabricating id/userId/createdAt placeholders to satisfy the full type.
export type MailAccountLike = Pick<
  EmailAccount,
  "provider" | "email" | "oauthRefreshTokenEnc" | "imapHost" | "imapPort" | "imapUser" | "imapPasswordEnc"
> &
  Partial<Pick<EmailAccount, "smtpHost" | "smtpPort">>;

function requireOAuthField(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} isn't configured -- set it from /admin/settings or the equivalent env var.`);
  }
  return value;
}

async function getAccessToken(account: MailAccountLike): Promise<string> {
  const refreshToken = decryptSecret(requireField(account.oauthRefreshTokenEnc, "oauthRefreshTokenEnc"));
  const oauth = await resolveOAuthConfig();
  if (account.provider === "gmail") {
    return getGmailAccessToken({
      clientId: requireOAuthField(oauth.googleClientId, "GOOGLE_CLIENT_ID"),
      clientSecret: requireOAuthField(oauth.googleClientSecret, "GOOGLE_CLIENT_SECRET"),
      refreshToken,
    });
  }
  if (account.provider === "outlook") {
    return getMicrosoftAccessToken({
      clientId: requireOAuthField(oauth.microsoftClientId, "MICROSOFT_CLIENT_ID"),
      clientSecret: requireOAuthField(oauth.microsoftClientSecret, "MICROSOFT_CLIENT_SECRET"),
      tenant: oauth.microsoftTenant,
      refreshToken,
    });
  }
  throw new Error(`getAccessToken called for non-OAuth provider: ${account.provider}`);
}

function requireField<T>(value: T | null, field: string): T {
  if (value === null || value === undefined) {
    throw new Error(`EmailAccount is missing required field for its provider: ${field}`);
  }
  return value;
}

/**
 * Opens an IMAP connection for any linked account, branching on its
 * provider -- the multi-provider counterpart to imap-connect.ts's
 * Gmail-only connectImap (kept as-is there, now used only by the
 * imap-test diagnostic script). gmail/outlook both use XOAUTH2 over real
 * IMAP (DESIGN.md section 2's whole point: avoid each provider's
 * quota-limited REST API); imap is plain LOGIN auth against a
 * caller-supplied host, e.g. Fastmail or a corporate mailbox.
 */
export async function connectAccountImap(
  account: MailAccountLike,
  extraOptions: Partial<ImapFlowOptions> = {},
): Promise<ImapFlow> {
  let options: ImapFlowOptions;

  if (account.provider === "gmail") {
    options = {
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: account.email, accessToken: await getAccessToken(account) },
      logger: false,
    };
  } else if (account.provider === "outlook") {
    options = {
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: account.email, accessToken: await getAccessToken(account) },
      logger: false,
    };
  } else if (account.provider === "imap") {
    options = {
      host: requireField(account.imapHost, "imapHost"),
      port: account.imapPort ?? 993,
      secure: true,
      auth: {
        user: account.imapUser ?? account.email,
        pass: decryptSecret(requireField(account.imapPasswordEnc, "imapPasswordEnc")),
      },
      logger: false,
    };
  } else {
    throw new Error(`Unknown provider: ${account.provider}`);
  }

  const client = new ImapFlow({ ...options, ...extraOptions });
  await client.connect();
  return client;
}

/**
 * SMTP counterpart to connectAccountImap. For OAuth providers, fetches the
 * access token ourselves and hands it to nodemailer directly (`auth.accessToken`)
 * rather than letting nodemailer manage its own refresh -- nodemailer's
 * built-in OAuth2 refresh flow is Google-endpoint-specific, so that path
 * only works for gmail; passing a pre-fetched token works identically for
 * any provider's XOAUTH2 SMTP.
 */
export async function createAccountSmtpTransport(account: MailAccountLike): Promise<Transporter> {
  if (account.provider === "gmail") {
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { type: "OAuth2", user: account.email, accessToken: await getAccessToken(account) },
    });
  }
  if (account.provider === "outlook") {
    return nodemailer.createTransport({
      host: "smtp.office365.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { type: "OAuth2", user: account.email, accessToken: await getAccessToken(account) },
    });
  }
  if (account.provider === "imap") {
    return nodemailer.createTransport({
      host: account.smtpHost ?? requireField(account.imapHost, "imapHost"),
      port: account.smtpPort ?? 587,
      secure: (account.smtpPort ?? 587) === 465,
      auth: {
        user: account.imapUser ?? account.email,
        pass: decryptSecret(requireField(account.imapPasswordEnc, "imapPasswordEnc")),
      },
    });
  }
  throw new Error(`Unknown provider: ${account.provider}`);
}
