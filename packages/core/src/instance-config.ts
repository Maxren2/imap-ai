import { prisma } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

const INSTANCE_ID = "instance";

/** Always returns the single settings row, creating it on first read -- avoids every call site needing its own upsert-or-default dance. */
async function getOrCreateInstanceSettings() {
  return prisma.instanceSettings.upsert({
    where: { id: INSTANCE_ID },
    update: {},
    create: { id: INSTANCE_ID },
  });
}

export interface OAuthConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  microsoftClientId?: string;
  microsoftClientSecret?: string;
  microsoftTenant: string;
}

/**
 * Resolves the Google/Microsoft OAuth app credentials used for both mail
 * linking and calendar linking -- GUI-set values (via /admin/settings)
 * take precedence field-by-field, falling back to the equivalent env var
 * when a field hasn't been set in the GUI. This is what lets an admin
 * change these from the app without editing the TrueNAS YAML or
 * restarting the container, while a deployment that's never touched
 * /admin/settings keeps working exactly as it did from env vars alone.
 */
export async function resolveOAuthConfig(): Promise<OAuthConfig> {
  const row = await getOrCreateInstanceSettings();
  return {
    googleClientId: row.googleClientId || process.env.GOOGLE_CLIENT_ID || undefined,
    googleClientSecret: row.googleClientSecretEnc ? decryptSecret(row.googleClientSecretEnc) : process.env.GOOGLE_CLIENT_SECRET || undefined,
    microsoftClientId: row.microsoftClientId || process.env.MICROSOFT_CLIENT_ID || undefined,
    microsoftClientSecret: row.microsoftClientSecretEnc
      ? decryptSecret(row.microsoftClientSecretEnc)
      : process.env.MICROSOFT_CLIENT_SECRET || undefined,
    microsoftTenant: row.microsoftTenant || process.env.MICROSOFT_TENANT || "common",
  };
}

export interface OAuthConfigInput {
  googleClientId?: string | null;
  googleClientSecret?: string | null;
  microsoftClientId?: string | null;
  microsoftClientSecret?: string | null;
  microsoftTenant?: string | null;
}

/**
 * Updates the GUI-configurable OAuth fields. A field passed as `undefined`
 * is left untouched; `null` or `""` clears it back to the env-var
 * fallback. A secret is only re-encrypted when a new non-empty value is
 * given -- the admin form never round-trips the existing plaintext (it
 * can't decrypt what it never received), so leaving a secret field blank
 * on save must mean "keep what's already there", not "clear it" -- a
 * bare null, not undefined, is the only way to explicitly clear one
 * (used by the "Remove" action for a given field).
 */
export async function updateOAuthConfig(input: OAuthConfigInput): Promise<void> {
  await getOrCreateInstanceSettings();
  const data: Record<string, string | null> = {};

  if (input.googleClientId !== undefined) data.googleClientId = input.googleClientId || null;
  if (input.googleClientSecret !== undefined) {
    data.googleClientSecretEnc = input.googleClientSecret ? encryptSecret(input.googleClientSecret) : null;
  }
  if (input.microsoftClientId !== undefined) data.microsoftClientId = input.microsoftClientId || null;
  if (input.microsoftClientSecret !== undefined) {
    data.microsoftClientSecretEnc = input.microsoftClientSecret ? encryptSecret(input.microsoftClientSecret) : null;
  }
  if (input.microsoftTenant !== undefined) data.microsoftTenant = input.microsoftTenant || null;

  await prisma.instanceSettings.update({ where: { id: INSTANCE_ID }, data });
}

export async function getDefaultLlmModelId(): Promise<string | null> {
  const row = await getOrCreateInstanceSettings();
  return row.defaultLlmModelId;
}

export async function setDefaultLlmModelId(modelId: string | null): Promise<void> {
  await getOrCreateInstanceSettings();
  await prisma.instanceSettings.update({ where: { id: INSTANCE_ID }, data: { defaultLlmModelId: modelId } });
}
