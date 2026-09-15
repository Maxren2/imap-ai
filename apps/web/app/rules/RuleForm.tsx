import { saveRule } from "./actions";
import { parseRuleConditions, type RuleConditions } from "@imap-ai/core/rules/types";
import { parseRuleActions, type RuleActions } from "@imap-ai/core/rules/actions";
import type { Prisma } from "@imap-ai/core/prisma";

const CONDITION_ROWS = 4;
const CONDITION_FIELDS = ["fromAddress", "fromName", "subject", "labels"] as const;
const CONDITION_OPERATORS = ["contains", "equals", "startsWith"] as const;

type RuleRow = Prisma.RuleGetPayload<{}>;

function safeParseConditions(raw: unknown): RuleConditions {
  if (!raw) return [];
  try {
    return parseRuleConditions(raw);
  } catch {
    return [];
  }
}

function safeParseActions(raw: unknown): RuleActions {
  if (!raw) return [];
  try {
    return parseRuleActions(raw);
  } catch {
    return [];
  }
}

export function RuleForm({ rule }: { rule?: RuleRow }) {
  const conditions = safeParseConditions(rule?.conditions);
  const actions = safeParseActions(rule?.actions);
  const label = actions.find((action) => action.type === "label");

  const saveWithId = saveRule.bind(null, rule?.id ?? null);

  return (
    <form className="rule-form" action={saveWithId}>
      <div className="field">
        <label htmlFor="name">Name</label>
        <input id="name" name="name" type="text" defaultValue={rule?.name} required />
      </div>

      <div className="checkbox-row">
        <input id="enabled" name="enabled" type="checkbox" defaultChecked={rule?.enabled ?? true} />
        <label htmlFor="enabled">Enabled</label>
      </div>

      <div className="field">
        <label>Conditions (all must match)</label>
        {Array.from({ length: CONDITION_ROWS }).map((_, i) => {
          const existing = conditions[i];
          return (
            <div className="condition-row" key={i}>
              <select name={`condition_${i}_field`} defaultValue={existing?.field ?? ""}>
                <option value="">— field —</option>
                {CONDITION_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
              <select name={`condition_${i}_operator`} defaultValue={existing?.operator ?? "contains"}>
                {CONDITION_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>
              <input
                type="text"
                name={`condition_${i}_value`}
                defaultValue={existing?.value ?? ""}
                placeholder="value"
              />
            </div>
          );
        })}
      </div>

      <div className="field">
        <label htmlFor="aiPrompt">AI prompt (optional)</label>
        <textarea
          id="aiPrompt"
          name="aiPrompt"
          defaultValue={rule?.aiPrompt ?? ""}
          placeholder="e.g. The email is a security alert about a new sign-in."
        />
        <span className="subtle">
          Evaluated by your local Ollama model against messages that already pass the conditions above (if any).
          Needs OLLAMA_BASE_URL/OLLAMA_MODEL configured.
        </span>
      </div>

      <div className="field">
        <label>Actions on match</label>
        <div className="actions-grid">
          <div className="checkbox-row">
            <input id="action_archive" name="action_archive" type="checkbox" defaultChecked={actions.some((a) => a.type === "archive")} />
            <label htmlFor="action_archive">Archive</label>
          </div>
          <div className="checkbox-row">
            <input id="action_markRead" name="action_markRead" type="checkbox" defaultChecked={actions.some((a) => a.type === "markRead")} />
            <label htmlFor="action_markRead">Mark read</label>
          </div>
          <div className="checkbox-row">
            <input id="action_star" name="action_star" type="checkbox" defaultChecked={actions.some((a) => a.type === "star")} />
            <label htmlFor="action_star">Star</label>
          </div>
          <input
            type="text"
            name="action_label"
            defaultValue={label?.type === "label" ? label.label : ""}
            placeholder="Label name (optional)"
            style={{ minWidth: "10rem" }}
          />
        </div>
        <span className="subtle">
          An existing Gmail label is reused if the name matches; otherwise a new one is created. Reserved system
          labels (Inbox, Sent, Important, etc.) can&apos;t be targeted.
        </span>
      </div>

      <div className="btn-row">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <a href="/rules" className="btn">
          Cancel
        </a>
      </div>
    </form>
  );
}
