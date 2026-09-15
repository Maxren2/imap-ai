import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@imap-ai/core/db";
import { ruleConditionsSchema, conditionalOperatorSchema, type RuleConditions } from "@imap-ai/core/rules/types";
import { ruleActionsSchema, type RuleActions } from "@imap-ai/core/rules/actions";

// packages/core's rule schemas are zod v3 instances; apps/web is on zod v4
// (ollama-ai-provider-v2 requires it). Composing a v3 schema directly into
// a v4 z.object() loses type inference (silently becomes `unknown`), even
// though both validate correctly at runtime. So the tool's inputSchema
// below is a fresh v4-native shape (kept in sync by hand with core's
// RuleCondition/RuleAction shapes), and the *authoritative* validation
// still goes through core's real zod v3 schemas inside execute() via
// .parse() before anything is written to the database.
const conditionShape = z.object({
  field: z.enum(["fromAddress", "fromName", "toAddress", "subject", "labels"]),
  operator: z.enum(["contains", "equals", "startsWith"]),
  value: z.string().min(1),
});

const actionShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("label"), label: z.string().min(1) }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("markRead") }),
  z.object({ type: z.literal("star") }),
]);

/**
 * Deliberately a small v1 tool set (list/create rules, search the local
 * mirror) rather than porting inbox-zero's ~20 Gmail-API-backed tools
 * (send/reply/forward/archive/etc.) -- those need real guardrails around
 * an LLM taking mailbox-mutating actions autonomously that this first
 * pass doesn't have yet. Read-only + rule-creation only for now.
 */
export function createChatTools(accountId: string) {
  return {
    listRules: tool({
      description: "List the user's current email rules: name, enabled state, conditions, AI prompt, actions, and how many messages each has matched.",
      inputSchema: z.object({}),
      execute: async () => {
        const rules = await prisma.rule.findMany({
          where: { accountId },
          orderBy: { name: "asc" },
          include: { _count: { select: { matches: true } } },
        });
        return rules.map((rule) => ({
          name: rule.name,
          enabled: rule.enabled,
          conditions: rule.conditions,
          aiPrompt: rule.aiPrompt,
          actions: rule.actions,
          matchCount: rule._count.matches,
        }));
      },
    }),

    createRule: tool({
      description:
        "Create a new email rule. Provide a name and at least one of: conditions (deterministic field/operator/value checks on fromAddress/fromName/toAddress/subject/labels) or aiPrompt (a natural-language description evaluated by AI). If both are given, conditionalOperator controls how they combine: 'AND' (default) means conditions act as a cheap pre-filter and the AI prompt only runs on what already passed; 'OR' means either alone is enough to match. Optionally specify actions (label/archive/markRead/star) to apply automatically to matches. New rules don't run automatically -- tell the user to trigger detection from the Rules page.",
      inputSchema: z.object({
        name: z.string().min(1),
        conditions: z.array(conditionShape).optional(),
        aiPrompt: z.string().min(1).optional(),
        conditionalOperator: z.enum(["AND", "OR"]).optional(),
        actions: z.array(actionShape).optional(),
        enabled: z.boolean().optional(),
      }),
      execute: async ({ name, conditions, aiPrompt, conditionalOperator, actions, enabled }) => {
        if (!conditions && !aiPrompt) {
          return { error: "A rule needs at least one condition or an AI prompt -- ask the user which they'd prefer." };
        }
        // Re-validate against core's authoritative (zod v3) schemas before
        // writing -- the inputSchema above is a hand-kept-in-sync copy for
        // the AI SDK's sake, not the source of truth.
        const validatedConditions: RuleConditions | undefined = conditions
          ? ruleConditionsSchema.parse(conditions)
          : undefined;
        const validatedActions: RuleActions | undefined = actions ? ruleActionsSchema.parse(actions) : undefined;
        const validatedConditionalOperator = conditionalOperatorSchema.catch("AND").parse(conditionalOperator);

        const rule = await prisma.rule.create({
          data: {
            accountId,
            name,
            enabled: enabled ?? true,
            conditions: validatedConditions,
            aiPrompt,
            actions: validatedActions,
            conditionalOperator: validatedConditionalOperator,
          },
        });
        return {
          id: rule.id,
          name: rule.name,
          message: `Created rule "${rule.name}". It won't match anything until detection runs (from the Rules page, or ask the user to run it).`,
        };
      },
    }),

    // Deliberately NOT a mutating tool, despite the name/description
    // sounding like it archives on its own -- this only *proposes* an
    // archive (a read-only count query). The AI SDK's built-in tool-approval
    // mechanism (`toolApproval` on streamText) was tried first and found
    // unreliable in live testing: after a real Approve click, the model
    // sometimes fabricated a success message in plain text without the
    // tool's `execute` ever actually re-running, meaning it would report an
    // archive as done when it silently wasn't -- unacceptable for a
    // mutating action. Instead, the real mutation happens via a plain
    // button in the chat UI (see chat-client.tsx) that calls the
    // bulk-archive server action DIRECTLY, bypassing the model entirely for
    // the actual execution step -- simpler and independently verifiable,
    // not dependent on a bleeding-edge SDK subsystem this project can't
    // fully trust yet.
    archiveSender: tool({
      description:
        "Use this when the user wants to archive mail from a sender right now (a one-time request) -- do NOT use createRule for this. Looks up how many inboxed messages that sender has. This does NOT archive anything -- after calling this, tell the user you've found the count and that they need to click the Confirm Archive button themselves to actually do it. Never tell the user their mail has been archived just because you called this tool.",
      inputSchema: z.object({
        fromAddress: z.string().min(1).describe("The sender's email address to check"),
      }),
      execute: async ({ fromAddress }) => {
        const inboxCount = await prisma.message.count({ where: { fromAddress, inInbox: true } });
        return { fromAddress, inboxCount };
      },
    }),

    searchInbox: tool({
      description: "Search the user's synced mail by sender address/name or subject substring (case-insensitive). Returns a count and a few recent examples.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Text to search for in sender address, sender name, or subject"),
      }),
      execute: async ({ query }) => {
        const where = {
          OR: [
            { fromAddress: { contains: query, mode: "insensitive" as const } },
            { fromName: { contains: query, mode: "insensitive" as const } },
            { subject: { contains: query, mode: "insensitive" as const } },
          ],
        };
        const [count, examples] = await Promise.all([
          prisma.message.count({ where }),
          prisma.message.findMany({
            where,
            orderBy: { date: "desc" },
            take: 5,
            select: { subject: true, fromAddress: true, fromName: true, date: true },
          }),
        ]);
        return { count, examples };
      },
    }),
  };
}
