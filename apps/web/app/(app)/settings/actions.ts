"use server";

import { prisma } from "@imap-ai/core/db";
import { revalidatePath } from "next/cache";
import { runNpmScript, getLatestBackgroundRuns, type BackgroundRunRow } from "@/lib/background-run";
import { getActiveEmailAccount, requireUser } from "@/lib/session";

export interface SyncDepthData {
  accountEmail: string;
  syncDepthDays: number;
}

export async function getSyncDepth(): Promise<SyncDepthData> {
  const account = await getActiveEmailAccount();
  return { accountEmail: account.email, syncDepthDays: account.syncDepthDays };
}

/**
 * Updates the active account's configured sync depth (30/90/0="all", see
 * EmailAccount.syncDepthDays) and, if there's a mailbox with potentially
 * more to fetch under the new window, re-opens its backfill boundary from
 * the *oldest currently-synced message* (not from scratch) and triggers a
 * background backfill honoring it. Widening the window (e.g. 30 -> 90
 * days) only fetches the newly-included gap this way; narrowing it deletes
 * nothing already synced -- the next backfill run just immediately finds
 * nothing left to do under the new cutoff and marks itself complete (see
 * backfillOlderMessages's reachedCutoff logic).
 */
export async function applySyncDepth(depthDays: number): Promise<void> {
  const account = await getActiveEmailAccount();
  await prisma.emailAccount.update({ where: { id: account.id }, data: { syncDepthDays: depthDays } });

  const mailbox = await prisma.mailbox.findFirst({ where: { accountId: account.id, name: "INBOX" } });
  if (mailbox) {
    const oldest = await prisma.message.aggregate({ where: { mailboxId: mailbox.id }, _min: { uid: true } });
    const oldestUid = oldest._min.uid;
    if (oldestUid !== null && oldestUid > 1) {
      await prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { backfillBeforeUid: oldestUid - 1, fullyBackfilled: false },
      });
      await runNpmScript("backfill", "backfill", "/settings", account.id);
    }
  }

  revalidatePath("/settings");
}

export async function getSettingsBackgroundRuns(): Promise<BackgroundRunRow[]> {
  const account = await getActiveEmailAccount();
  return getLatestBackgroundRuns(account.id, ["backfill"]);
}

export interface AvailabilityData {
  timezone: string;
  days: string[];
  start: string;
  end: string;
}

export async function getAvailability(): Promise<AvailabilityData> {
  const user = await requireUser();
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  return {
    timezone: row.availabilityTimezone ?? "",
    days: row.availabilityDays,
    start: row.availabilityStart ?? "09:00",
    end: row.availabilityEnd ?? "17:00",
  };
}

export async function updateAvailability(data: AvailabilityData): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      availabilityTimezone: data.timezone || null,
      availabilityDays: data.days,
      availabilityStart: data.start || null,
      availabilityEnd: data.end || null,
    },
  });
  revalidatePath("/settings");
}

export interface LlmModelOption {
  id: string;
  label: string;
}

export interface LlmPreferenceData {
  options: LlmModelOption[];
  preferredModelId: string | null;
  defaultModelLabel: string | null;
}

/**
 * Only models an admin has flipped `enabledForUsers` on show up as
 * choices here -- an admin can register/default a model without
 * offering it for users to switch to themselves (see LlmModel's schema
 * comment). `defaultModelLabel` is shown so "Use instance default"
 * reads as an actual choice ("Use instance default (Local Ollama:
 * qwen3:8b)") instead of a mystery option.
 */
export async function getLlmPreference(): Promise<LlmPreferenceData> {
  const user = await requireUser();
  const [row, models, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { preferredLlmModelId: true } }),
    prisma.llmModel.findMany({ where: { enabledForUsers: true }, include: { provider: true }, orderBy: { createdAt: "asc" } }),
    prisma.instanceSettings.findUnique({ where: { id: "instance" }, include: { defaultLlmModel: { include: { provider: true } } } }),
  ]);

  return {
    options: models.map((m) => ({ id: m.id, label: `${m.provider.name}: ${m.modelId}` })),
    preferredModelId: row.preferredLlmModelId,
    defaultModelLabel: settings?.defaultLlmModel ? `${settings.defaultLlmModel.provider.name}: ${settings.defaultLlmModel.modelId}` : null,
  };
}

export async function updateLlmPreference(modelId: string | null): Promise<void> {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { preferredLlmModelId: modelId } });
  revalidatePath("/settings");
}
