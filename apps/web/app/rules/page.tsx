import { prisma } from "@imap-ai/core/db";
import { deleteRule, toggleRule, triggerRulesRun, triggerApplyActions, getLatestBackgroundRuns } from "./actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackgroundRunsPanel } from "./BackgroundRunsPanel";
import Link from "next/link";
import { Plus, Play, Zap } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const [rules, backgroundRuns] = await Promise.all([
    prisma.rule.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { matches: true } } },
    }),
    getLatestBackgroundRuns(),
  ]);

  const pendingActionCounts = await Promise.all(
    rules.map((rule) =>
      rule.actions ? prisma.ruleMatch.count({ where: { ruleId: rule.id, actionsAppliedAt: null } }) : null,
    ),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Rules</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Detection (<code className="rounded bg-muted px-1 py-0.5">rules:run</code>) and action execution (
        <code className="rounded bg-muted px-1 py-0.5">rules:apply-actions</code>) run separately and
        independently-idempotently — matching is cheap to run often, acting on the real mailbox is not.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button asChild size="sm">
          <Link href="/rules/new">
            <Plus /> New rule
          </Link>
        </Button>
        <form action={triggerRulesRun}>
          <Button type="submit" size="sm" variant="outline">
            <Play /> Run detection now
          </Button>
        </form>
        <form action={triggerApplyActions}>
          <Button type="submit" size="sm" variant="outline">
            <Zap /> Apply pending actions now
          </Button>
        </form>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        These run in the background — live output below updates automatically while running.
      </p>
      <BackgroundRunsPanel initialRuns={backgroundRuns} />

      {rules.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No rules yet. Try <code className="rounded bg-muted px-1 py-0.5">npm run rules:seed-example</code> or{" "}
          <code className="rounded bg-muted px-1 py-0.5">npm run rules:seed-basic</code> from the repo root, or
          create one above.
        </p>
      ) : (
        <div className="mt-6 rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Matches</TableHead>
                <TableHead>Pending actions</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((rule, i) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">
                    <Link href={`/rules/${rule.id}/edit`} className="hover:underline">
                      {rule.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="font-normal">
                      {rule.aiPrompt ? (rule.conditions ? "conditions + AI" : "AI") : "conditions"}
                      {rule.actions ? " + actions" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <form action={toggleRule}>
                      <input type="hidden" name="id" value={rule.id} />
                      <Button type="submit" size="sm" variant={rule.enabled ? "default" : "outline"}>
                        {rule.enabled ? "Enabled" : "Disabled"}
                      </Button>
                    </form>
                  </TableCell>
                  <TableCell>{rule._count.matches.toLocaleString()}</TableCell>
                  <TableCell>{pendingActionCounts[i] === null ? "—" : pendingActionCounts[i]!.toLocaleString()}</TableCell>
                  <TableCell>
                    <form action={deleteRule}>
                      <input type="hidden" name="id" value={rule.id} />
                      <Button type="submit" size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                        Delete
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </main>
  );
}
