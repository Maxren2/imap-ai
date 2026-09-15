import { z } from "zod";

export const ruleConditionSchema = z.object({
  field: z.enum(["fromAddress", "fromName", "subject", "labels"]),
  operator: z.enum(["contains", "equals", "startsWith"]),
  value: z.string().min(1),
});

export type RuleCondition = z.infer<typeof ruleConditionSchema>;

// All conditions must match (AND) for v1 -- no OR/grouping yet, kept
// simple until there's a real need for it.
export const ruleConditionsSchema = z.array(ruleConditionSchema).min(1);

export type RuleConditions = z.infer<typeof ruleConditionsSchema>;

export function parseRuleConditions(raw: unknown): RuleConditions {
  return ruleConditionsSchema.parse(raw);
}
