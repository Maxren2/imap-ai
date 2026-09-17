import type { LlmConfig } from "./llm-config.js";

const MAX_BODY_CHARS_IN_PROMPT = 3000;

export interface AiMatchInput {
  prompt: string;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  body: string | null;
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface OllamaChatResponse {
  message?: { content?: string };
}

interface OpenAiChatResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Sends one chat completion request, branching on the provider type --
 * Ollama's native /api/chat (unchanged from before multi-provider
 * support existed) or an OpenAI-compatible /v1/chat/completions (used
 * for "openai" providers, and for any self-hosted server that speaks
 * the same API shape via a custom apiBaseUrl, see LlmProvider). Both
 * APIs are close enough in shape (a messages array in, a single
 * response message out) that every call site above this just builds
 * `messages` once and doesn't need to know which provider it's talking
 * to.
 */
async function chatCompletion(config: LlmConfig, messages: ChatMessage[], temperature: number): Promise<string> {
  if (config.type === "ollama") {
    const response = await fetch(`${config.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.model, stream: false, options: { temperature }, messages }),
    });
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status} ${response.statusText} (${await response.text()})`);
    }
    const data = (await response.json()) as OllamaChatResponse;
    return data.message?.content?.trim() ?? "";
  }

  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, temperature, messages }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI-compatible request failed: ${response.status} ${response.statusText} (${await response.text()})`);
  }
  const data = (await response.json()) as OpenAiChatResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Asks the local LLM whether a message matches a rule's natural-language
 * prompt. Deliberately metadata-only for now (subject/sender, no body) --
 * message bodies aren't synced yet (see DESIGN.md), so match quality is
 * bounded by that until lazy body fetch exists.
 */
// Deliberately no `think: false` / reasoning-disable option passed for the
// ollama branch (thinking stays enabled, for models like qwen3 that
// support it): thinking measurably improved classification accuracy on
// messy real-world input in testing (a borderline message with raw HTML/
// CSS fragments leaked into its extracted body text was correctly
// classified "not cold" with thinking enabled, but produced a false
// positive without it), and Ollama's response keeps `message.content`
// clean of the `thinking` field regardless. ~25s/candidate is fine for
// rules:run's background batch use; the chat feature has its own
// separate, interactive-latency reason for disabling thinking via
// ollama-ai-provider-v2, unaffected by this file.
export async function evaluateAiPrompt(config: LlmConfig, input: AiMatchInput): Promise<boolean> {
  const content = await chatCompletion(
    config,
    [
      {
        role: "system",
        content:
          "You are an email rule-matching assistant. Given a rule description and an email's sender/subject, decide whether the email matches the rule. Respond with exactly one word: yes or no. Do not explain.",
      },
      {
        role: "user",
        content: [
          `Rule: ${input.prompt}`,
          "",
          `From: ${input.fromName ? `${input.fromName} <${input.fromAddress ?? ""}>` : (input.fromAddress ?? "(unknown)")}`,
          `Subject: ${input.subject ?? "(no subject)"}`,
          `Body: ${input.body ? input.body.slice(0, MAX_BODY_CHARS_IN_PROMPT) : "(no body available)"}`,
          "",
          "Does this email match the rule? Answer yes or no.",
        ].join("\n"),
      },
    ],
    0,
  );
  return content.trim().toLowerCase().startsWith("yes");
}

export interface AiDraftInput {
  instructions: string;
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  body: string | null;
  // Plain-text calendar availability/busy-times block (see
  // calendar/availability.ts's buildAvailabilityContext) -- undefined
  // when the account's owner has no calendar connected, in which case
  // nothing calendar-related is added to the prompt at all.
  availabilityContext?: string;
}

/**
 * Asks the local LLM to write a reply body from a rule's plain-language
 * instructions plus the original message -- the generation counterpart to
 * evaluateAiPrompt's yes/no classification above. Used by both the
 * "draft" (never sent, saved to Drafts for review) and "autoReply"
 * (sent immediately) rule actions -- see rules/sending-actions.ts. The
 * distinction between those two is entirely in what the caller does with
 * the returned text, not in how it's generated.
 */
export async function generateReplyDraft(config: LlmConfig, input: AiDraftInput): Promise<string> {
  const text = await chatCompletion(
    config,
    [
      {
        role: "system",
        content:
          "You draft plain-text email replies on someone's behalf, following their instructions. Write ONLY the reply body -- no subject line, no explanation of what you're doing, no markdown formatting, no placeholder brackets. Match the language of the original email. Sign off simply if appropriate, but do not invent a name if none is given in the instructions.",
      },
      {
        role: "user",
        content: [
          `Instructions for this reply: ${input.instructions}`,
          "",
          `Original email from: ${input.fromName ? `${input.fromName} <${input.fromAddress ?? ""}>` : (input.fromAddress ?? "(unknown)")}`,
          `Subject: ${input.subject ?? "(no subject)"}`,
          `Body: ${input.body ? input.body.slice(0, MAX_BODY_CHARS_IN_PROMPT) : "(no body available)"}`,
          ...(input.availabilityContext ? ["", "Calendar availability -- if this reply involves scheduling, propose real times from this instead of vague availability:", input.availabilityContext] : []),
          "",
          "Write the reply body now.",
        ].join("\n"),
      },
    ],
    0.3,
  );
  if (!text) throw new Error("AI returned an empty draft.");
  return text;
}
