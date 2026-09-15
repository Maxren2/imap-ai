"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { Loader } from "@/components/ai-elements/loader";
import { Button } from "@/components/ui/button";
import { archiveSenders } from "@/app/bulk-archive/actions";

export function ChatClient({ chatId, initialMessages }: { chatId: string; initialMessages: UIMessage[] }) {
  const router = useRouter();
  const { messages, sendMessage, status } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/chat", body: { chatId } }),
    // The sidebar (ChatSidebar, rendered by the server-component chat
    // layout) doesn't auto-refresh when the API route auto-titles a new
    // chat or bumps its updatedAt -- refresh here so the sidebar's title
    // and ordering catch up once a reply actually finishes, without
    // remounting this chat's own message state.
    onFinish: () => router.refresh(),
  });

  // archiveSender is a read-only "how many messages would this affect"
  // lookup (see lib/ai/tools.ts) -- the actual archive only happens when
  // the user clicks this button, which calls the real server action
  // directly, bypassing the model entirely. Keyed by toolCallId so each
  // tool call in the conversation tracks its own confirm/pending/done
  // state independently.
  const [archiveResults, setArchiveResults] = useState<Record<string, { archived: number }>>({});
  const [pendingToolCallId, setPendingToolCallId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function confirmArchive(toolCallId: string, fromAddress: string) {
    setPendingToolCallId(toolCallId);
    startTransition(async () => {
      const result = await archiveSenders([fromAddress]);
      setArchiveResults((prev) => ({ ...prev, [toolCallId]: result }));
      setPendingToolCallId(null);
    });
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Sparkles className="size-6" />}
              title="Ask your assistant"
              description='Try "list my rules", "create a rule for GitHub notifications", or "how many emails from LinkedIn do I have?"'
            />
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent>
                  {message.parts.map((part, i) => {
                    if (part.type === "text") {
                      return <MessageResponse key={i}>{part.text}</MessageResponse>;
                    }
                    if (part.type.startsWith("tool-")) {
                      const toolPart = part as unknown as {
                        type: `tool-${string}`;
                        toolCallId: string;
                        state: "input-streaming" | "input-available" | "output-available" | "output-error";
                        input: unknown;
                        output?: unknown;
                        errorText?: string;
                      };
                      const isArchiveLookup = toolPart.type === "tool-archiveSender" && toolPart.state === "output-available";
                      const fromAddress = (toolPart.input as { fromAddress?: string } | undefined)?.fromAddress;
                      const archiveResult = archiveResults[toolPart.toolCallId];

                      return (
                        <Tool key={i}>
                          <ToolHeader type={toolPart.type} state={toolPart.state} />
                          <ToolContent>
                            <ToolInput input={toolPart.input} />
                            <ToolOutput output={toolPart.output} errorText={toolPart.errorText} />
                            {isArchiveLookup && fromAddress && (
                              <div className="px-4 pb-4">
                                {archiveResult ? (
                                  <p className="text-sm text-muted-foreground">
                                    Archived {archiveResult.archived} message{archiveResult.archived === 1 ? "" : "s"} from{" "}
                                    {fromAddress}.
                                  </p>
                                ) : (
                                  <Button
                                    size="sm"
                                    disabled={isPending && pendingToolCallId === toolPart.toolCallId}
                                    onClick={() => confirmArchive(toolPart.toolCallId, fromAddress)}
                                  >
                                    {isPending && pendingToolCallId === toolPart.toolCallId && <Loader2 className="animate-spin" />}
                                    Confirm Archive
                                  </Button>
                                )}
                              </div>
                            )}
                          </ToolContent>
                        </Tool>
                      );
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && <Loader />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-4">
        <PromptInput
          onSubmit={(message) => {
            if (message.text.trim()) sendMessage({ text: message.text });
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea placeholder="Ask about your rules or inbox..." />
          </PromptInputBody>
          <div className="flex justify-end p-2">
            <PromptInputSubmit status={status} />
          </div>
        </PromptInput>
      </div>
    </div>
  );
}
