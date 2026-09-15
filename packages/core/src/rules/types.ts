import { z } from "zod";

// toAddress added alongside the original fromAddress/fromName/subject/
// labels, matching part of the field vocabulary inbox-zero's own static
// condition bundle uses (from/to/subject/body) -- confirmed from its real
// source rather than guessed. `body` deliberately NOT added: deterministic
// conditions are evaluated with no IMAP calls at all (a documented,
// relied-on property elsewhere), but a message's body is only ever
// fetched lazily, on demand, for a rule that has an aiPrompt -- adding a
// body condition would mean either breaking that invariant (fetching
// bodies just to check a plain condition) or having it silently only work
// against whatever happened to already be cached, which is a worse
// surprise than not having the field at all. Revisit if/when body
// conditions are worth a real design, not a quick add.
export const ruleConditionSchema = z.object({
  field: z.enum(["fromAddress", "fromName", "toAddress", "subject", "labels"]),
  operator: z.enum(["contains", "equals", "startsWith"]),
  value: z.string().min(1),
});

export type RuleCondition = z.infer<typeof ruleConditionSchema>;

// All conditions within this array always AND together -- matches
// inbox-zero's own real model (its static from/to/subject/body bundle has
// no OR between fields either). OR only applies one level up, between
// this whole array and aiPrompt -- see Rule.conditionalOperator.
export const ruleConditionsSchema = z.array(ruleConditionSchema).min(1);

export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export function parseRuleConditions(raw: unknown): RuleConditions {
  return ruleConditionsSchema.parse(raw);
}

export const conditionalOperatorSchema = z.enum(["AND", "OR"]);
export type ConditionalOperator = z.infer<typeof conditionalOperatorSchema>;
