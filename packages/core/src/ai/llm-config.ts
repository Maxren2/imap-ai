import { prisma } from "../db";
import { decryptSecret } from "../crypto";
import type { LlmModel, LlmProvider } from "../generated/prisma/index.js";

export type LlmConfig =
  | { type: "ollama"; baseUrl: string; model: string }
  | { type: "openai"; apiKey: string; baseUrl: string; model: string };

function toLlmConfig(model: LlmModel & { provider: LlmProvider }): LlmConfig | undefined {
  if (model.provider.type === "ollama") {
    if (!model.provider.baseUrl) return undefined;
    return { type: "ollama", baseUrl: model.provider.baseUrl.replace(/\/$/, ""), model: model.modelId };
  }
  if (model.provider.type === "openai") {
    if (!model.provider.apiKeyEnc) return undefined;
    return {
      type: "openai",
      apiKey: decryptSecret(model.provider.apiKeyEnc),
      baseUrl: (model.provider.apiBaseUrl || "https://api.openai.com").replace(/\/$/, ""),
      model: model.modelId,
    };
  }
  return undefined;
}

/** Env-only fallback for a deployment that's never touched /admin/settings -- same OLLAMA_BASE_URL/OLLAMA_MODEL pair this app always read, kept as the zero-config default. */
function envFallback(): LlmConfig | undefined {
  const baseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL;
  if (!baseUrl || !model) return undefined;
  return { type: "ollama", baseUrl: baseUrl.replace(/\/$/, ""), model };
}

/**
 * Resolves which LLM a given user's AI actions (rule matching, draft/
 * auto-reply generation, chat) should use -- their own preference
 * (User.preferredLlmModelId) if set and still admin-enabled, else the
 * org-wide default (InstanceSettings.defaultLlmModelId) an admin set
 * from /admin/settings, else the legacy OLLAMA_BASE_URL/OLLAMA_MODEL env
 * pair for a deployment that's never configured anything in the GUI.
 * Returns undefined when nothing usable is configured anywhere -- same
 * "AI features are simply unavailable" outcome resolveOllamaConfig used
 * to signal, now resolvable to any admin-registered provider instead of
 * only a single env-configured Ollama instance.
 */
export async function resolveLlmConfigForUser(userId: string): Promise<LlmConfig | undefined> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferredLlmModel: { include: { provider: true } } },
  });

  if (user?.preferredLlmModel?.enabledForUsers) {
    const config = toLlmConfig(user.preferredLlmModel);
    if (config) return config;
  }

  const settings = await prisma.instanceSettings.findUnique({
    where: { id: "instance" },
    select: { defaultLlmModel: { include: { provider: true } } },
  });
  if (settings?.defaultLlmModel) {
    const config = toLlmConfig(settings.defaultLlmModel);
    if (config) return config;
  }

  return envFallback();
}
