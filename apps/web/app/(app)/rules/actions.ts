"use server";

import { prisma } from "@imap-ai/core/db";
import { Prisma } from "@imap-ai/core/prisma";
import { ruleConditionsSchema, conditionalOperatorSchema, type RuleConditions } from "@imap-ai/core/rules/types";
import { ruleActionsSchema, type RuleActions } from "@imap-ai/core/rules/actions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runNpmScript, getLatestBackgroundRuns as getLatestBackgroundRunsShared, type BackgroundRunRow } from "@/lib/background-run";
import { getActiveEmailAccount } from "@/lib/session";

const CONDITION_ROWS = 4;

function parseConditionsFromForm(formData: FormData): RuleConditions | null {
  const rows = [];
  for (let i = 0; i < CONDITION_ROWS; i++) {
    const field = formData.get(`condition_${i}_field`);
    const operator = formData.get(`condition_${i}_operator`);
    const value = (formData.get(`condition_${i}_value`) as string | null)?.trim();
    if (field && operator && value) {
      rows.push({ field, operator, value });
    }
  }
  if (rows.length === 0) return null;
  return ruleConditionsSchema.parse(rows);
}

function parseActionsFromForm(formData: FormData): RuleActions | null {
  const actions = [];
  const label = (formData.get("action_label") as string | null)?.trim();
  if (label) actions.push({ type: "label", label });
  if (formData.get("action_archive")) actions.push({ type: "archive" });
  if (formData.get("action_markRead")) actions.push({ type: "markRead" });
  if (formData.get("action_star")) actions.push({ type: "star" });
  if (formData.get("action_delete")) actions.push({ type: "delete" });

  if (formData.get("action_draft")) {
    const instructions = (formData.get("draft_instructions") as string | null)?.trim();
    if (instructions) actions.push({ type: "draft", instructions });
  }
  if (formData.get("action_autoReply")) {
    const instructions = (formData.get("autoReply_instructions") as string | null)?.trim();
    if (instructions) actions.push({ type: "autoReply", instructions });
  }
  if (formData.get("action_autoForward")) {
    const to = (formData.get("autoForward_to") as string | null)?.trim();
    const note = (formData.get("autoForward_note") as string | null)?.trim();
    if (to) actions.push({ type: "autoForward", to, ...(note ? { note } : {}) });
  }

  if (actions.length === 0) return null;
  return ruleActionsSchema.parse(actions);
}

export async function saveRule(ruleId: string | null, formData: FormData): Promise<void> {
  const name = (formData.get("name") as string | null)?.trim();
  if (!name) throw new Error("Name is required.");

  const enabled = formData.get("enabled") === "on";
  const aiPrompt = (formData.get("aiPrompt") as string | null)?.trim() || null;
  const conditions = parseConditionsFromForm(formData);
  const actions = parseActionsFromForm(formData);
  const conditionalOperator = conditionalOperatorSchema.catch("AND").parse(formData.get("conditionalOperator"));

  if (!conditions && !aiPrompt) {
    throw new Error("A rule needs at least one condition or an AI prompt.");
  }

  const conditionsValue = conditions ?? Prisma.DbNull;
  const actionsValue = actions ?? Prisma.DbNull;
  const account = await getActiveEmailAccount();

  if (ruleId) {
    // updateMany, scoped by accountId, not a plain update by id -- a
    // ruleId belonging to a different account must be a no-op, not an
    // edit of someone else's rule.
    await prisma.rule.updateMany({
      where: { id: ruleId, accountId: account.id },
      data: { name, enabled, aiPrompt, conditions: conditionsValue, actions: actionsValue, conditionalOperator },
    });
  } else {
    await prisma.rule.create({
      data: {
        accountId: account.id,
        name,
        enabled,
        aiPrompt,
        conditions: conditionsValue,
        actions: actionsValue,
        conditionalOperator,
      },
    });
  }

  revalidatePath("/rules");
  redirect("/rules");
}

export async function deleteRule(formData: FormData): Promise<void> {
  const account = await getActiveEmailAccount();
  const id = formData.get("id") as string;
  await prisma.rule.deleteMany({ where: { id, accountId: account.id } });
  revalidatePath("/rules");
}

export async function toggleRule(formData: FormData): Promise<void> {
  const account = await getActiveEmailAccount();
  const id = formData.get("id") as string;
  const rule = await prisma.rule.findFirstOrThrow({ where: { id, accountId: account.id } });
  await prisma.rule.update({ where: { id }, data: { enabled: !rule.enabled } });
  revalidatePath("/rules");
}

/**
 * rules:run permanently skips any message it's already matched (RuleMatch)
 * or, for AI rules, already evaluated and found not to match
 * (RuleAiEvaluation) -- by design, so a "no" doesn't get re-asked forever
 * (see run.ts's own long comment on that). That means editing a rule's
 * conditions or AI prompt doesn't reconsider anything it already decided
 * on under the old wording. This clears that bookkeeping for one rule so
 * the next rules:run evaluates every message against it from scratch --
 * does NOT undo any action already applied (archive/label/etc. stays
 * applied); it only resets what's been *checked*.
 */
export async function resetRuleProgress(id: string): Promise<void> {
  const account = await getActiveEmailAccount();
  const rule = await prisma.rule.findFirst({ where: { id, accountId: account.id } });
  if (!rule) return;

  await prisma.ruleMatch.deleteMany({ where: { ruleId: id } });
  await prisma.ruleAiEvaluation.deleteMany({ where: { ruleId: id } });
  revalidatePath(`/rules/${id}/edit`);
  revalidatePath("/rules");
}

// Fire-and-forget background npm script runner + BackgroundRun reader --
// see apps/web/lib/background-run.ts for the full history of why this
// works the way it does (detached:true silently broke stdio capture on
// Windows). Extracted there so other pages (e.g. the homepage's backfill
// trigger) can reuse the exact same mechanism.
export async function triggerRulesRun(): Promise<void> {
  const account = await getActiveEmailAccount();
  await runNpmScript("rules:run", "rules:run", "/rules", account.id);
}

export async function triggerApplyActions(): Promise<void> {
  const account = await getActiveEmailAccount();
  await runNpmScript("rules:apply-actions", "rules:apply-actions", "/rules", account.id);
}

export type { BackgroundRunRow };

export async function getLatestBackgroundRuns(): Promise<BackgroundRunRow[]> {
  const account = await getActiveEmailAccount();
  return getLatestBackgroundRunsShared(account.id, ["rules:run", "rules:apply-actions"]);
}
