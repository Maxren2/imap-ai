"use server";

import { prisma } from "@imap-ai/core/db";
import { Prisma } from "@imap-ai/core/prisma";
import { ruleConditionsSchema, type RuleConditions } from "@imap-ai/core/rules/types";
import { ruleActionsSchema, type RuleActions } from "@imap-ai/core/rules/actions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { spawn } from "node:child_process";
import path from "node:path";

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

  if (!conditions && !aiPrompt) {
    throw new Error("A rule needs at least one condition or an AI prompt.");
  }

  const conditionsValue = conditions ?? Prisma.DbNull;
  const actionsValue = actions ?? Prisma.DbNull;

  if (ruleId) {
    await prisma.rule.update({
      where: { id: ruleId },
      data: { name, enabled, aiPrompt, conditions: conditionsValue, actions: actionsValue },
    });
  } else {
    const account = await prisma.account.findFirstOrThrow();
    await prisma.rule.create({
      data: { accountId: account.id, name, enabled, aiPrompt, conditions: conditionsValue, actions: actionsValue },
    });
  }

  revalidatePath("/rules");
  redirect("/rules");
}

export async function deleteRule(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  await prisma.rule.delete({ where: { id } });
  revalidatePath("/rules");
}

export async function toggleRule(formData: FormData): Promise<void> {
  const id = formData.get("id") as string;
  const rule = await prisma.rule.findUniqueOrThrow({ where: { id } });
  await prisma.rule.update({ where: { id }, data: { enabled: !rule.enabled } });
  revalidatePath("/rules");
}

// Fire-and-forget: these can take a while (IMAP + AI calls), so they run
// as a detached process outside the request/response cycle rather than
// blocking a server action. Reuses the exact same `npm run` scripts
// already verified from the command line, from the repo root -- same
// workspace delegation, no duplicated logic. `shell: true` because a bare
// `npm` isn't directly executable on Windows (it's a .cmd shim).
function runNpmScript(script: string): void {
  const repoRoot = path.resolve(process.cwd(), "../..");
  const child = spawn("npm", ["run", script], { cwd: repoRoot, detached: true, stdio: "ignore", shell: true });
  child.unref();
}

export async function triggerRulesRun(): Promise<void> {
  runNpmScript("rules:run");
}

export async function triggerApplyActions(): Promise<void> {
  runNpmScript("rules:apply-actions");
}
