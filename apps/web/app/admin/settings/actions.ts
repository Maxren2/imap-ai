"use server";

import { prisma } from "@imap-ai/core/db";
import { encryptSecret } from "@imap-ai/core/crypto";
import { resolveOAuthConfig, updateOAuthConfig } from "@imap-ai/core/instance-config";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import webPackageJson from "../../../package.json";

export async function getAppVersion(): Promise<string> {
  return webPackageJson.version;
}

export interface OAuthStatus {
  googleClientId: string;
  googleClientSecretSet: boolean;
  microsoftClientId: string;
  microsoftClientSecretSet: boolean;
  microsoftTenant: string;
}

/** Never returns a secret's actual value -- only whether one is currently set, sourced from the GUI or an env var either way. */
export async function getOAuthStatus(): Promise<OAuthStatus> {
  await requireAdmin();
  const config = await resolveOAuthConfig();
  return {
    googleClientId: config.googleClientId ?? "",
    googleClientSecretSet: !!config.googleClientSecret,
    microsoftClientId: config.microsoftClientId ?? "",
    microsoftClientSecretSet: !!config.microsoftClientSecret,
    microsoftTenant: config.microsoftTenant,
  };
}

/**
 * Saves the Google OAuth app credentials from the admin form. Client id
 * is always overwritten with whatever's in the field (blank clears it --
 * there's nothing secret about a client id, so round-tripping it to the
 * browser and back is fine). The secret field is different: it's never
 * sent back to the browser after the first save, so a blank submission
 * means "leave it alone", not "clear it" -- use clearGoogleSecret for
 * that.
 */
export async function updateGoogleOAuth(clientId: string, clientSecret: string): Promise<void> {
  await requireAdmin();
  await updateOAuthConfig({
    googleClientId: clientId || null,
    googleClientSecret: clientSecret ? clientSecret : undefined,
  });
  revalidatePath("/admin/settings");
}

export async function clearGoogleSecret(): Promise<void> {
  await requireAdmin();
  await updateOAuthConfig({ googleClientSecret: null });
  revalidatePath("/admin/settings");
}

export async function updateMicrosoftOAuth(clientId: string, clientSecret: string, tenant: string): Promise<void> {
  await requireAdmin();
  await updateOAuthConfig({
    microsoftClientId: clientId || null,
    microsoftClientSecret: clientSecret ? clientSecret : undefined,
    microsoftTenant: tenant || null,
  });
  revalidatePath("/admin/settings");
}

export async function clearMicrosoftSecret(): Promise<void> {
  await requireAdmin();
  await updateOAuthConfig({ microsoftClientSecret: null });
  revalidatePath("/admin/settings");
}

export interface LlmModelRow {
  id: string;
  modelId: string;
  enabledForUsers: boolean;
}

export interface LlmProviderRow {
  id: string;
  type: string;
  name: string;
  baseUrl: string | null;
  apiBaseUrl: string | null;
  apiKeySet: boolean;
  models: LlmModelRow[];
}

export async function listLlmProviders(): Promise<LlmProviderRow[]> {
  await requireAdmin();
  const providers = await prisma.llmProvider.findMany({
    orderBy: { createdAt: "asc" },
    include: { models: { orderBy: { createdAt: "asc" } } },
  });
  return providers.map((p) => ({
    id: p.id,
    type: p.type,
    name: p.name,
    baseUrl: p.baseUrl,
    apiBaseUrl: p.apiBaseUrl,
    apiKeySet: !!p.apiKeyEnc,
    models: p.models.map((m) => ({ id: m.id, modelId: m.modelId, enabledForUsers: m.enabledForUsers })),
  }));
}

export async function addOllamaProvider(name: string, baseUrl: string): Promise<string> {
  await requireAdmin();
  const provider = await prisma.llmProvider.create({
    data: { type: "ollama", name: name || "Ollama", baseUrl: baseUrl.replace(/\/$/, "") },
  });
  revalidatePath("/admin/settings");
  return provider.id;
}

export async function addOpenAiProvider(name: string, apiKey: string, apiBaseUrl: string): Promise<string> {
  await requireAdmin();
  const provider = await prisma.llmProvider.create({
    data: {
      type: "openai",
      name: name || "OpenAI",
      apiKeyEnc: encryptSecret(apiKey),
      apiBaseUrl: apiBaseUrl ? apiBaseUrl.replace(/\/$/, "") : null,
    },
  });
  revalidatePath("/admin/settings");
  return provider.id;
}

export async function removeProvider(providerId: string): Promise<void> {
  await requireAdmin();
  // Cascades to its LlmModels (schema.prisma), which in turn SetNull any
  // User.preferredLlmModelId / InstanceSettings.defaultLlmModelId that
  // pointed at one -- nobody's left referencing a deleted model.
  await prisma.llmProvider.delete({ where: { id: providerId } });
  revalidatePath("/admin/settings");
  revalidatePath("/settings");
}

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

interface OpenAiModelsResponse {
  data?: { id?: string }[];
}

/**
 * Fetches the list of models actually available from a provider's live
 * endpoint -- Ollama's /api/tags (everything pulled on that instance) or
 * OpenAI-compatible /v1/models, filtered to a chat-capable-looking
 * subset (excludes embeddings/whisper/tts/image/moderation ids, which
 * clutter OpenAI's real /v1/models response and would never work as a
 * chat completion model anyway). Read-only -- doesn't register anything;
 * the admin still picks which of these to add via addModelToProvider.
 */
export async function fetchAvailableModels(providerId: string): Promise<string[]> {
  await requireAdmin();
  const provider = await prisma.llmProvider.findUniqueOrThrow({ where: { id: providerId } });

  if (provider.type === "ollama") {
    if (!provider.baseUrl) throw new Error("This provider has no base URL configured.");
    const response = await fetch(`${provider.baseUrl}/api/tags`);
    if (!response.ok) throw new Error(`Ollama /api/tags request failed: ${response.status}`);
    const data = (await response.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => m.name).filter((name): name is string => !!name);
  }

  if (!provider.apiKeyEnc) throw new Error("This provider has no API key configured.");
  const { decryptSecret } = await import("@imap-ai/core/crypto");
  const baseUrl = provider.apiBaseUrl || "https://api.openai.com";
  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${decryptSecret(provider.apiKeyEnc)}` },
  });
  if (!response.ok) throw new Error(`/v1/models request failed: ${response.status}`);
  const data = (await response.json()) as OpenAiModelsResponse;
  const EXCLUDE_PATTERN = /embedding|whisper|tts|dall-e|moderation|davinci|babbage|ada|curie/i;
  return (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => !!id && !EXCLUDE_PATTERN.test(id))
    .sort();
}

export async function addModelToProvider(providerId: string, modelId: string): Promise<void> {
  await requireAdmin();
  await prisma.llmModel.upsert({
    where: { providerId_modelId: { providerId, modelId } },
    update: {},
    create: { providerId, modelId },
  });
  revalidatePath("/admin/settings");
}

export async function setModelEnabledForUsers(modelId: string, enabled: boolean): Promise<void> {
  await requireAdmin();
  await prisma.llmModel.update({ where: { id: modelId }, data: { enabledForUsers: enabled } });
  revalidatePath("/admin/settings");
  revalidatePath("/settings");
}

export async function removeModel(modelId: string): Promise<void> {
  await requireAdmin();
  await prisma.llmModel.delete({ where: { id: modelId } });
  revalidatePath("/admin/settings");
  revalidatePath("/settings");
}

export async function getDefaultLlmModel(): Promise<string | null> {
  await requireAdmin();
  const settings = await prisma.instanceSettings.findUnique({ where: { id: "instance" } });
  return settings?.defaultLlmModelId ?? null;
}

export async function setDefaultLlmModel(modelId: string | null): Promise<void> {
  await requireAdmin();
  await prisma.instanceSettings.upsert({
    where: { id: "instance" },
    update: { defaultLlmModelId: modelId },
    create: { id: "instance", defaultLlmModelId: modelId },
  });
  revalidatePath("/admin/settings");
  revalidatePath("/settings");
}
