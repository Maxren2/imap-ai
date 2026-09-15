import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { createOllama } from "ollama-ai-provider-v2";
import { prisma } from "@imap-ai/core/db";
import { Prisma } from "@imap-ai/core/prisma";
import { createChatTools } from "@/lib/ai/tools";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const SYSTEM_PROMPT =
  "You are the assistant built into imap-ai, a self-hosted email tool that reads/syncs mail over IMAP into a local database (not the Gmail API). " +
  "You can list the user's automation rules, create new ones (deterministic conditions and/or an AI-matched natural-language prompt, with optional actions), " +
  "search their synced mailbox by sender or subject, and look up how many inboxed messages a given sender has. " +
  "When the user asks to archive mail from a sender right now (a one-time request, e.g. 'archive mail from X', 'clean up my inbox from Y'), use the sender-lookup tool -- do NOT create a rule for this, rules are only for ongoing/future automation the user explicitly asks to set up going forward. " +
  "The sender-lookup tool does NOT archive anything -- after calling it, tell the user the count and that they need to click the Confirm Archive button in the chat UI themselves to actually archive; " +
  "never say their mail has been archived, since you have no way to actually do that yourself. You cannot send, reply, or delete mail yet -- if asked, explain that's not built yet. " +
  "Be concise. When you create a rule, tell the user it won't apply to anything until detection is run.";

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json();

  const account = await prisma.account.findFirstOrThrow();
  const ollama = createOllama({
    baseURL: `${requireEnv("OLLAMA_BASE_URL").replace(/\/$/, "")}/api`,
    compatibility: "strict",
  });

  const chat = await prisma.chat.upsert({
    where: { accountId: account.id },
    update: {},
    create: { accountId: account.id },
  });

  const lastMessage = messages[messages.length - 1];
  if (lastMessage?.role === "user") {
    await prisma.chatMessage.create({
      data: { chatId: chat.id, role: "user", parts: lastMessage.parts as unknown as Prisma.InputJsonValue },
    });
  }

  const result = streamText({
    model: ollama(requireEnv("OLLAMA_MODEL")),
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
