import { streamText, convertToModelMessages, stepCountIs, type UIMessage, type LanguageModel } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { createOpenAI } from "@ai-sdk/openai";
import { prisma } from "@imap-ai/core/db";
import { Prisma } from "@imap-ai/core/prisma";
import { resolveLlmConfigForUser } from "@imap-ai/core/ai/llm-config";
import { createChatTools } from "@/lib/ai/tools";
import { getActiveEmailAccount } from "@/lib/session";

/**
 * Builds the AI SDK model instance for whichever LLM this account's owner
 * is configured to use (their own preference, the org default, or the
 * legacy env-only fallback -- see resolveLlmConfigForUser). The chat
 * feature previously only ever talked to one env-configured Ollama
 * instance; this is the same dynamic resolution rules/apply-actions.ts
 * already uses for draft/auto-reply generation, applied here too.
 */
async function resolveChatModel(userId: string): Promise<LanguageModel> {
  const config = await resolveLlmConfigForUser(userId);
  if (!config) {
    throw new Error("No LLM is configured for this account -- see /admin/settings or /settings.");
  }
  if (config.type === "openai") {
    return createOpenAI({ apiKey: config.apiKey, baseURL: `${config.baseUrl}/v1` })(config.model);
  }
  const ollama = createOllama({ baseURL: `${config.baseUrl}/api`, compatibility: "strict" });
  return ollama(config.model);
}

const SYSTEM_PROMPT =
  "You are the assistant built into imap-ai, a self-hosted email tool that reads/syncs mail over IMAP into a local database (not the Gmail API). " +
  "You can list the user's automation rules, create new ones (deterministic conditions and/or an AI-matched natural-language prompt, with optional actions), " +
  "search their synced mailbox by sender or subject, and look up how many inboxed messages a given sender has. " +
  "When the user asks to archive or label mail from a sender right now (a one-time request, e.g. 'archive mail from X', 'label mail from Y as Newsletter'), use the archiveSender/labelSender lookup tools -- do NOT create a rule for this, rules are only for ongoing/future automation the user explicitly asks to set up going forward. " +
  "Neither lookup tool actually archives or labels anything -- after calling one, tell the user the count and that they need to click the Confirm Archive/Confirm Label button in the chat UI themselves to actually do it; " +
  "never say mail has been archived or labeled, since you have no way to actually do that yourself. You cannot send, reply, or delete mail yet -- if asked, explain that's not built yet. " +
  "Be concise. When you create a rule, tell the user it won't apply to anything until detection is run.";

export async function POST(request: Request) {
  const { messages, chatId }: { messages: UIMessage[]; chatId: string } = await request.json();

  const account = await getActiveEmailAccount();
  const model = await resolveChatModel(account.userId);

  // The chat row always exists before the first message -- /chat/actions.ts's
  // createChat() creates it and navigates here, and /chat (the index route)
  // resolves to an existing or freshly-created thread before rendering the
  // client. Scoped to this account so a stale/foreign chatId 404s instead of
  // silently reading someone else's thread.
  const chat = await prisma.chat.findFirstOrThrow({ where: { id: chatId, accountId: account.id } });

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === "user") {
    await prisma.chatMessage.create({
      data: { chatId: chat.id, role: "user", parts: lastMessage.parts as unknown as Prisma.InputJsonValue },
    });
    // Also bumps `updatedAt` (Prisma's @updatedAt fires on any update to the
    // row) so the sidebar's most-recently-active-first ordering reflects
    // this message, not just renames.
    const firstText = !chat.name ? lastMessage.parts.find((part) => part.type === "text")?.text?.trim() : undefined;
    await prisma.chat.update({
      where: { id: chat.id },
      data: firstText ? { name: firstText.slice(0, 60) } : {},
    });
  }

  const result = streamText({
    model,
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: createChatTools(account.id),
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finalMessages }) => {
      const newMessages = finalMessages.slice(messages.length);
      for (const message of newMessages) {
        await prisma.chatMessage.create({
          data: { chatId: chat.id, role: message.role, parts: message.parts as unknown as Prisma.InputJsonValue },
        });
      }
    },
  });
}
