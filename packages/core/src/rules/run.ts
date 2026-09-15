import "../env.js";
import { prisma } from "../db.js";
import { connectImap, requireEnv } from "../imap-connect.js";
import { parseRuleConditions, type RuleConditions } from "./types.js";
import { evaluateConditions, type MatchableMessage } from "./evaluate.js";
import { resolveOllamaConfig, evaluateAiPrompt } from "../ai/ollama.js";
import { ensureMessageBody } from "../body.js";
import { mapWithConcurrency } from "../async.js";
import type { ImapFlow } from "imapflow";

// Local LLM calls have no external quota to worry about, but a local Ollama
// server still only has so much throughput -- keep this modest rather than
// firing hundreds of requests at once.
const AI_CONCURRENCY = 3;

// Caps AI evaluations per rule per run, so a rule with a large untouched
// backlog (e.g. right after a big backfill) doesn't turn one run into a
// multi-hour AI sweep -- the rest is simply picked up on the next run,
// same idea as the sync cursor.
const AI_MAX_PER_RUN = Number(process.env.RULES_AI_MAX_PER_RUN) || 200;

type Candidate = MatchableMessage & {
  id: string;
  uid: number;
  bodyText: string | null;
  bodyFetchedAt: Date | null;
};

async function main() {
  const rules = await prisma.rule.findMany({ where: { enabled: true } });

  if (rules.length === 0) {
    console.log("No enabled rules.");
    return;
  }

  const ollamaConfig = resolveOllamaConfig();
  const needsImap = rules.some((rule) => rule.enabled && rule.aiPrompt);

  // Only connect to IMAP (and only lock INBOX) if some enabled rule
  // actually needs body content -- a purely deterministic rule set never
  // touches the network at all.
  let imapClient: ImapFlow | undefined;
  let releaseLock: (() => void) | undefined;
  if (needsImap && ollamaConfig) {
    const gmailAddress = requireEnv("GMAIL_ADDRESS");
    imapClient = await connectImap(gmailAddress);
    const lock = await imapClient.getMailboxLock("INBOX");
    releaseLock = () => lock.release();
  }

  try {
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

      // Only messages this rule hasn't already matched, or (for AI rules)
      // already evaluated and found not to match -- without excluding the
      // latter too, a non-matching message would be re-selected (and
      // re-sent to the AI) on every future run forever, since only real
      // matches get a RuleMatch row. Combined with the "newest first, capped
      // per run" ordering below, that would mean a rule's per-run AI cap
      // smaller than its backlog could NEVER progress past the same newest
      // N candidates, no matter how many times it's re-run -- a real bug
      // found running Cold Email Blocker against ~11,000 real candidates
      // for the first time with a low RULES_AI_MAX_PER_RUN.
      const candidates: Candidate[] = await prisma.message.findMany({
        where: {
          mailbox: { accountId: rule.accountId },
          ruleMatches: { none: { ruleId: rule.id } },
          ruleAiEvaluations: { none: { ruleId: rule.id } },
        },
        orderBy: { date: "desc" },
        select: {
          id: true,
          uid: true,
          subject: true,
          fromAddress: true,
          fromName: true,
          toAddress: true,
          labels: true,
          bodyText: true,
          bodyFetchedAt: true,
        },
      });

      const deterministicPass = conditions
        ? candidates.filter((message) => evaluateConditions(conditions!, message))
        : candidates;

      // "AND" (default): conditions are a cheap pre-filter, aiPrompt only
      // runs on what already passed -- unchanged from before this field
      // existed. "OR": a message that already passed conditions matches
      // immediately (same short-circuit inbox-zero's real OR mode uses),
      // so only the *non*-passing messages need an AI call -- guarded on
      // `conditions` being set at all, so an AI-only rule (no conditions)
      // still sends its whole candidate pool to AI regardless of this
      // field's stored value.
      const conditionalOperator = rule.conditionalOperator === "OR" ? "OR" : "AND";
      const deterministicPassIds = new Set(deterministicPass.map((m) => m.id));
      const aiPool =
        conditionalOperator === "OR" && conditions
          ? candidates.filter((m) => !deterministicPassIds.has(m.id))
          : deterministicPass;

      let finalMatches: Candidate[];
      if (!rule.aiPrompt) {
        finalMatches = deterministicPass;
      } else if (!ollamaConfig || !imapClient) {
        // AI unreachable: in OR mode the deterministic side alone is
        // still a valid partial answer (either side matching is enough);
        // in AND mode a match needs both, so there's nothing to report
        // yet -- same as before this field existed.
        finalMatches = conditionalOperator === "OR" ? deterministicPass : [];
      } else {
        const aiCandidates = aiPool.slice(0, AI_MAX_PER_RUN);

        // Body fetches go through one shared IMAP connection, so they're
        // done sequentially here rather than inside the concurrent AI step
        // below -- imapflow's `download()` returns a streaming response,
        // and running several of those concurrently on the same connection
        // was found to corrupt the stream (a message's download resolving
        // to something with no async iterator, crashing the whole worker)
        // rather than erroring cleanly. Most candidates already have a
        // cached body from a prior run (ensureMessageBody returns
        // immediately for those), so this is only slow for genuinely new
        // fetches.
        const bodies = new Map<string, string | null>();
        for (const message of aiCandidates) {
          try {
            bodies.set(message.id, await ensureMessageBody(imapClient!, message));
          } catch (error) {
            console.error(`Body fetch failed for message ${message.id} on rule "${rule.name}":`, error);
          }
        }

        // Pure HTTP calls to Ollama from here on -- safe to run concurrently.
        const aiResults = await mapWithConcurrency(aiCandidates, AI_CONCURRENCY, async (message) => {
          if (!bodies.has(message.id)) return { message, matches: false };
          try {
            const matches = await evaluateAiPrompt(ollamaConfig, {
              prompt: rule.aiPrompt!,
              subject: message.subject,
              fromAddress: message.fromAddress,
              fromName: message.fromName,
              body: bodies.get(message.id) ?? null,
            });
            return { message, matches };
          } catch (error) {
            console.error(`AI evaluation failed for message ${message.id} on rule "${rule.name}":`, error);
            return { message, matches: false };
          }
        });
        const aiMatches = aiResults.filter((r) => r.matches).map((r) => r.message);
        // In OR mode, aiPool already excludes deterministic-passing
        // messages, so this is a plain concatenation, not a risk of
        // double-counting the same message from both sides.
        finalMatches = conditionalOperator === "OR" ? [...deterministicPass, ...aiMatches] : aiMatches;

        // Record every candidate actually sent to the AI (matched or not)
        // as evaluated, so a "no" doesn't get re-asked forever -- only
        // candidates whose body fetch failed are left off, so those are
        // retried (a fetch failure is more likely transient than a
        // considered "no").
        const evaluatedIds = aiCandidates.filter((message) => bodies.has(message.id)).map((message) => message.id);
        if (evaluatedIds.length > 0) {
          await prisma.ruleAiEvaluation.createMany({
            data: evaluatedIds.map((messageId) => ({ ruleId: rule.id, messageId })),
            skipDuplicates: true,
          });
        }
      }

      if (finalMatches.length > 0) {
        await prisma.ruleMatch.createMany({
          data: finalMatches.map((message) => ({ ruleId: rule.id, messageId: message.id })),
          skipDuplicates: true,
        });
      }

      const aiSuffix =
        rule.aiPrompt && ollamaConfig
          ? ` (${Math.min(aiPool.length, AI_MAX_PER_RUN)} of ${aiPool.length} eligible sent to AI, with body)`
          : "";
      console.log(`Rule "${rule.name}": ${finalMatches.length} new match(es) out of ${candidates.length} candidate(s)${aiSuffix}.`);
    }
  } finally {
    releaseLock?.();
    await imapClient?.logout();
  }
}

main()
  .catch((error) => {
    console.error("rules:run failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
