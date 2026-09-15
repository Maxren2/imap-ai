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
  "and search their synced mailbox by sender or subject. You cannot send, archive, or otherwise mutate mail yet -- if asked, explain that's done from the Inbox/Rules pages for now. " +
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
