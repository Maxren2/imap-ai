"use server";

import { prisma } from "@imap-ai/core/db";
import { Prisma } from "@imap-ai/core/prisma";
import { ruleConditionsSchema, type RuleConditions } from "@imap-ai/core/rules/types";
import { ruleActionsSchema, type RuleActions } from "@imap-ai/core/rules/actions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

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

// Fire-and-forget: these can take a while (IMAP + AI calls -- AI rule
// matching in particular, now that Ollama "thinking" models are left at
// their default rather than sped up at the cost of accuracy, see
// DESIGN.md section 19). Reuses the exact same `npm run` scripts already
// verified from the command line, from the repo root -- same workspace
// delegation, no duplicated logic. `shell: true` because a bare `npm`
// isn't directly executable on Windows (it's a .cmd shim).
//
// stdout/stderr are captured into a BackgroundRun row (previously fully
// discarded via stdio: "ignore", the only way to see progress was to
// manually poll the database or the OS process list) via shell-native
// redirection (`> file 2>&1` appended to the command line itself) rather
// than any of Node's own stdio-passing mechanisms, both of which were
// tried first and silently produced nothing on Windows (confirmed via
// psql/direct file reads, not assumed): piped stdio (`stdio: "pipe"` +
// `.on("data", ...)`) never fired a single event despite the child
// finishing successfully, and passing a real file descriptor directly
// (`stdio: [ignore, fd, fd]`) left the file at 0 bytes through to process
// exit. The actual root cause turned out to be simpler than either fix
// assumed: this function had `detached: true` set, on the mistaken
// assumption that "detached" was needed to keep a background task from
// blocking the HTTP request/response cycle. It isn't -- `spawn()` is
// already non-blocking regardless of `detached`, and the "parent" here is
// this long-lived Next.js server process, not the short-lived request, so
// there was never a lifecycle reason to detach the child from it either.
// Isolated with a standalone test script: the exact same spawn + shell
// redirection worked perfectly with `detached: false` and produced
// completely empty output with `detached: true`, with no other variable
// changed. Removing `detached` fixed stdout capture outright.
async function runNpmScript(script: string, kind: string): Promise<void> {
  const account = await prisma.account.findFirstOrThrow();
  const run = await prisma.backgroundRun.create({ data: { accountId: account.id, kind } });

  const repoRoot = path.resolve(process.cwd(), "../..");
  const logPath = path.join(os.tmpdir(), `imap-ai-run-${run.id}.log`);

  const child = spawn("npm", ["run", script, ">", `"${logPath}"`, "2>&1"], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: true,
  });

  function readLog(): string {
    try {
      return fs.readFileSync(logPath, "utf-8");
    } catch {
      return "";
    }
  }

  const pollTimer = setInterval(() => {
    prisma.backgroundRun.update({ where: { id: run.id }, data: { log: readLog() } }).catch(() => {});
  }, 1500);

  child.on("close", (code) => {
    clearInterval(pollTimer);
    prisma.backgroundRun
      .update({
        where: { id: run.id },
        data: { log: readLog(), status: code === 0 ? "succeeded" : "failed", finishedAt: new Date() },
      })
      .catch(() => {})
      .finally(() => {
        try {
          fs.unlinkSync(logPath);
        } catch {}
      });
  });

  revalidatePath("/rules");
}

export async function triggerRulesRun(): Promise<void> {
  await runNpmScript("rules:run", "rules:run");
}

export async function triggerApplyActions(): Promise<void> {
  await runNpmScript("rules:apply-actions", "rules:apply-actions");
}

export interface BackgroundRunRow {
  id: string;
  kind: string;
  status: string;
  log: string;
  startedAtIso: string;
  finishedAtIso: string | null;
}

export async function getLatestBackgroundRuns(): Promise<BackgroundRunRow[]> {
  const account = await prisma.account.findFirst();
  if (!account) return [];
  const runs = await prisma.backgroundRun.findMany({
    where: { accountId: account.id },
    orderBy: { startedAt: "desc" },
    take: 5,
  });
  return runs.map((run) => ({
    id: run.id,
    kind: run.kind,
    status: run.status,
    log: run.log,
    startedAtIso: run.startedAt.toISOString(),
    finishedAtIso: run.finishedAt?.toISOString() ?? null,
  }));
}
