import type { RuleCondition, RuleConditions } from "./types.js";

export interface MatchableMessage {
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  labels: string[];
}

function matchesCondition(condition: RuleCondition, message: MatchableMessage): boolean {
  const target = condition.value.toLowerCase();

  if (condition.field === "labels") {
    return message.labels.some((label) => label.toLowerCase() === target);
  }

  const fieldValue = (message[condition.field] ?? "").toLowerCase();
  switch (condition.operator) {
    case "contains":
      return fieldValue.includes(target);
    case "equals":
      return fieldValue === target;
    case "startsWith":
      return fieldValue.startsWith(target);
  }
}

export function evaluateConditions(conditions: RuleConditions, message: MatchableMessage): boolean {
  return conditions.every((condition) => matchesCondition(condition, message));
}
