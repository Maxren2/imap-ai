import "../env.js";
import { prisma } from "../db.js";
import { parseRuleConditions, type RuleConditions } from "./types.js";
import { evaluateConditions, type MatchableMessage } from "./evaluate.js";
import { resolveOllamaConfig, evaluateAiPrompt } from "../ai/ollama.js";
import { mapWithConcurrency } from "../async.js";

// Local LLM calls have no external quota to worry about, but a local Ollama
// server still only has so much throughput -- keep this modest rather than
// firing hundreds of requests at once.
const AI_CONCURRENCY = 3;

// Caps AI evaluations per rule per run, so a rule with a large untouched
// backlog (e.g. right after a big backfill) doesn't turn one run into a
// multi-hour AI sweep -- the rest is simply picked up on the next run,
// same idea as the sync cursor.
const AI_MAX_PER_RUN = Number(process.env.RULES_AI_MAX_PER_RUN) || 200;

type Candidate = MatchableMessage & { id: string };

async function main() {
  const rules = await prisma.rule.findMany({ where: { enabled: true } });

  if (rules.length === 0) {
    console.log("No enabled rules.");
    return;
  }

  const ollamaConfig = resolveOllamaConfig();

  for (const rule of rules) {
    let conditions: RuleConditions | null = null;
    if (rule.conditions) {
      try {
        conditions = parseRuleConditions(rule.conditions);
      } catch (error) {
        console.error(`Rule "${rule.name}" (${rule.id}) has invalid conditions, skipping:`, error);
        continue;
      }
    }

    if (!conditions && !rule.aiPrompt) {
      console.warn(`Rule "${rule.name}" has neither conditions nor an AI prompt, skipping.`);
      continue;
    }
    if (rule.aiPrompt && !ollamaConfig) {
      console.warn(
        `Rule "${rule.name}" has an AI prompt but OLLAMA_BASE_URL/OLLAMA_MODEL aren't configured; no matches will be recorded for it until they are.`,
      );
    }

    // Only messages this rule hasn't already matched -- re-running is cheap
    // and safe, it just picks up newly-synced mail.
    const candidates: Candidate[] = await prisma.message.findMany({
      where: { mailbox: { accountId: rule.accountId }, ruleMatches: { none: { ruleId: rule.id } } },
      orderBy: { date: "desc" },
      select: { id: true, subject: true, fromAddress: true, fromName: true, labels: true },
    });

    const deterministicPass = conditions ? candidates.filter((message) => evaluateConditions(conditions!, message)) : candidates;

    let finalMatches: Candidate[];
    if (!rule.aiPrompt) {
      finalMatches = deterministicPass;
    } else if (!ollamaConfig) {
      finalMatches = [];
    } else {
      const aiCandidates = deterministicPass.slice(0, AI_MAX_PER_RUN);
      const aiResults = await mapWithConcurrency(aiCandidates, AI_CONCURRENCY, async (message) => {
        try {
          const matches = await evaluateAiPrompt(ollamaConfig, {
            prompt: rule.aiPrompt!,
            subject: message.subject,
            fromAddress: message.fromAddress,
            fromName: message.fromName,
          });
          return { message, matches };
        } catch (error) {
          console.error(`AI evaluation failed for message ${message.id} on rule "${rule.name}":`, error);
          return { message, matches: false };
        }
      });
      finalMatches = aiResults.filter((r) => r.matches).map((r) => r.message);
    }

    if (finalMatches.length > 0) {
      await prisma.ruleMatch.createMany({
        data: finalMatches.map((message) => ({ ruleId: rule.id, messageId: message.id })),
        skipDuplicates: true,
      });
    }

    const aiSuffix =
      rule.aiPrompt && ollamaConfig
        ? ` (${Math.min(deterministicPass.length, AI_MAX_PER_RUN)} of ${deterministicPass.length} eligible sent to AI)`
        : "";
    console.log(`Rule "${rule.name}": ${finalMatches.length} new match(es) out of ${candidates.length} candidate(s)${aiSuffix}.`);
  }
}

main()
  .catch((error) => {
    console.error("rules:run failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
