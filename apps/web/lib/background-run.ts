import { prisma } from "@imap-ai/core/db";
import { revalidatePath } from "next/cache";
import { spawn, exec } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Fire-and-forget: runs an `npm run <script>` from the repo root as a
 * detached-from-nothing (see below) child process, capturing its output
 * into a BackgroundRun row so a page can show live progress instead of the
 * caller having to manually poll the database or the OS process list.
 * Originally built for /rules ("Run detection now" / "Apply pending
 * actions now"), extracted here so any page can trigger any npm script
 * this way -- see the homepage's "Sync full history" (backfill) trigger.
 *
 * `shell: true` because a bare `npm` isn't directly executable on Windows
 * (it's a .cmd shim). Output is captured via shell-native redirection
 * (`> file 2>&1` appended to the command line) rather than piped stdio or a
 * passed file descriptor -- both were tried first and silently produced
 * zero captured output on this Windows setup. The actual root cause was
 * `detached: true`, which is for decoupling a child from a *short-lived*
 * parent -- not needed here, since the real parent is this long-lived
 * Next.js server. Confirmed via a standalone A/B script changing only that
 * one option. Do not add `detached: true` back without re-verifying.
 */
export async function runNpmScript(
  script: string,
  kind: string,
  revalidate: string,
  accountId: string,
  env?: Record<string, string>,
): Promise<void> {
  const run = await prisma.backgroundRun.create({ data: { accountId, kind } });

  const repoRoot = path.resolve(process.cwd(), "../..");
  const logPath = path.join(os.tmpdir(), `imap-ai-run-${run.id}.log`);

  // `env` (e.g. Deep Clean's user-chosen options) is passed via the child
  // process's environment rather than as `npm run <script> -- <args>` CLI
  // args -- this spawn already goes through two layers of `npm run`
  // delegation (repo root -> the @imap-ai/core workspace), and forwarding
  // argv reliably through both hops (each needing its own `--`) is more
  // fragile than just setting env vars the leaf script reads directly.
  const child = spawn("npm", ["run", script, ">", `"${logPath}"`, "2>&1"], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: true,
    env: { ...process.env, ACCOUNT_ID: accountId, ...env },
  });

  // child.pid is the shell's PID (spawn used shell: true), stored so a
  // "Cancel" click from a later, separate request can find and kill it --
  // see cancelBackgroundRun below.
  if (child.pid) {
    prisma.backgroundRun.update({ where: { id: run.id }, data: { pid: child.pid } }).catch(() => {});
  }

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
    // A cancelled run already has its final status set by
    // cancelBackgroundRun before the killed process's own "close" event
    // gets here -- don't let this handler race it back to "failed".
    prisma.backgroundRun
      .findUnique({ where: { id: run.id }, select: { status: true } })
      .then((row) => {
        const status = row?.status === "cancelled" ? "cancelled" : code === 0 ? "succeeded" : "failed";
        return prisma.backgroundRun.update({
          where: { id: run.id },
          data: { log: readLog(), status, finishedAt: new Date(), pid: null },
        });
      })
      .catch(() => {})
      .finally(() => {
        try {
          fs.unlinkSync(logPath);
        } catch {}
      });
  });

  revalidatePath(revalidate);
}

/**
 * Kills a still-running background run. `spawn` above uses `shell: true`
 * (a Windows requirement -- npm isn't directly executable there), so
 * `child.pid` is the shell's PID, not the actual npm/node process running
 * underneath it; on Windows, `taskkill /T` kills that whole process tree,
 * not just the shell. No equivalent tree-kill is implemented for POSIX --
 * this project runs on Windows in practice (see user_environment_notes)
 * and `detached: true` (which a POSIX process-group kill would need) is
 * deliberately not used here (see runNpmScript's own comment on why).
 */
export async function cancelBackgroundRun(accountId: string, runId: string): Promise<void> {
  const run = await prisma.backgroundRun.findFirst({ where: { id: runId, accountId } });
  if (!run || run.status !== "running" || !run.pid) return;

  if (process.platform === "win32") {
    exec(`taskkill /PID ${run.pid} /T /F`, () => {});
  } else {
    try {
      process.kill(run.pid, "SIGTERM");
    } catch {}
  }

  await prisma.backgroundRun.update({
    where: { id: runId },
    data: { status: "cancelled", finishedAt: new Date(), pid: null },
  });
}

export interface BackgroundRunRow {
  id: string;
  kind: string;
  status: string;
  log: string;
  startedAtIso: string;
  finishedAtIso: string | null;
}

export async function getLatestBackgroundRuns(accountId: string, kinds?: string[]): Promise<BackgroundRunRow[]> {
  const runs = await prisma.backgroundRun.findMany({
    where: { accountId, ...(kinds ? { kind: { in: kinds } } : {}) },
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
