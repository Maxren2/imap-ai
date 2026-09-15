import { prisma } from "@imap-ai/core/db";
import { deleteRule, toggleRule, triggerRulesRun, triggerApplyActions } from "./actions";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const rules = await prisma.rule.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { matches: true } } },
  });

  const pendingActionCounts = await Promise.all(
    rules.map((rule) =>
      rule.actions ? prisma.ruleMatch.count({ where: { ruleId: rule.id, actionsAppliedAt: null } }) : null,
    ),
  );

  return (
    <main>
      <h1>Rules</h1>
      <p className="subtle">
        Detection (<code>rules:run</code>) and action execution (<code>rules:apply-actions</code>) run separately and
        independently-idempotently -- matching is cheap to run often, acting on the real mailbox is not.
      </p>

      <div className="btn-row">
        <a href="/rules/new" className="btn btn-primary">
          + New rule
        </a>
        <form action={triggerRulesRun}>
          <button type="submit" className="btn">
            Run detection now
          </button>
        </form>
        <form action={triggerApplyActions}>
          <button type="submit" className="btn">
            Apply pending actions now
          </button>
        </form>
      </div>
      <p className="subtle">
        These run in the background -- refresh this page after a bit to see updated match/action counts.
      </p>

      {rules.length === 0 ? (
        <p>
          No rules yet. Try <code>npm run rules:seed-example</code> or <code>npm run rules:seed-basic</code> from the
          repo root, or create one above.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Enabled</th>
              <th>Matches</th>
              <th>Pending actions</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule, i) => (
              <tr key={rule.id}>
                <td>
                  <a href={`/rules/${rule.id}/edit`}>{rule.name}</a>
                </td>
                <td>
                  <span className="badge">
                    {rule.aiPrompt ? (rule.conditions ? "conditions + AI" : "AI") : "conditions"}
                    {rule.actions ? " + actions" : ""}
                  </span>
                </td>
                <td>
                  <form action={toggleRule}>
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" className="btn">
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </button>
                  </form>
                </td>
                <td>{rule._count.matches.toLocaleString()}</td>
                <td>{pendingActionCounts[i] === null ? "—" : pendingActionCounts[i].toLocaleString()}</td>
                <td>
                  <form action={deleteRule}>
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" className="btn btn-danger">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
