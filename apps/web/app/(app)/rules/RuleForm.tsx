import { saveRule } from "./actions";
import { parseRuleConditions, type RuleConditions } from "@imap-ai/core/rules/types";
import { parseRuleActions, type RuleActions } from "@imap-ai/core/rules/actions";
import type { Prisma } from "@imap-ai/core/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";

const CONDITION_ROWS = 4;
const CONDITION_FIELDS = ["fromAddress", "fromName", "toAddress", "subject", "labels"] as const;
const CONDITION_OPERATORS = ["contains", "equals", "startsWith"] as const;

type RuleRow = Prisma.RuleGetPayload<{}>;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
  const draft = actions.find((action) => action.type === "draft");
  const autoReply = actions.find((action) => action.type === "autoReply");
  const autoForward = actions.find((action) => action.type === "autoForward");

  const saveWithId = saveRule.bind(null, rule?.id ?? null);

  return (
    <form className="flex max-w-xl flex-col gap-6" action={saveWithId}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Name
        </label>
        <Input id="name" name="name" type="text" defaultValue={rule?.name} required />
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="enabled" name="enabled" defaultChecked={rule?.enabled ?? true} />
        <label htmlFor="enabled" className="text-sm">
          Enabled
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Conditions (all must match)</label>
        {Array.from({ length: CONDITION_ROWS }).map((_, i) => {
          const existing = conditions[i];
          return (
            <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-2" key={i}>
              <select name={`condition_${i}_field`} defaultValue={existing?.field ?? ""} className={selectClass}>
                <option value="">— field —</option>
                {CONDITION_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {field}
                  </option>
                ))}
              </select>
              <select name={`condition_${i}_operator`} defaultValue={existing?.operator ?? "contains"} className={selectClass}>
                {CONDITION_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator}
                  </option>
                ))}
              </select>
              <Input type="text" name={`condition_${i}_value`} defaultValue={existing?.value ?? ""} placeholder="value" />
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="conditionalOperator" className="text-sm font-medium">
          Combine conditions and AI prompt with
        </label>
        <select
          id="conditionalOperator"
          name="conditionalOperator"
          defaultValue={rule?.conditionalOperator ?? "AND"}
          className={selectClass}
        >
          <option value="AND">AND — a message needs both to match</option>
          <option value="OR">OR — either alone is enough to match</option>
        </select>
        <span className="text-xs text-muted-foreground">
          Only matters when both are set. With AND, conditions act as a cheap pre-filter and the AI prompt only runs
          on what already passed. With OR, a message matching the conditions matches immediately (no AI call needed);
          a message that doesn&apos;t is still checked against the AI prompt.
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="aiPrompt" className="text-sm font-medium">
          AI prompt (optional)
        </label>
        <textarea
          id="aiPrompt"
          name="aiPrompt"
          defaultValue={rule?.aiPrompt ?? ""}
          placeholder="e.g. The email is a security alert about a new sign-in."
          className="min-h-24 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="text-xs text-muted-foreground">
          Evaluated by your configured LLM (Settings, or your admin's instance default).
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium">Actions on match</label>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="action_archive" name="action_archive" defaultChecked={actions.some((a) => a.type === "archive")} />
            <label htmlFor="action_archive" className="text-sm">
              Archive
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="action_markRead" name="action_markRead" defaultChecked={actions.some((a) => a.type === "markRead")} />
            <label htmlFor="action_markRead" className="text-sm">
              Mark read
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="action_star" name="action_star" defaultChecked={actions.some((a) => a.type === "star")} />
            <label htmlFor="action_star" className="text-sm">
              Star
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="action_delete" name="action_delete" defaultChecked={actions.some((a) => a.type === "delete")} />
            <label htmlFor="action_delete" className="text-sm">
              Delete
            </label>
          </div>
          <Input
            type="text"
            name="action_label"
            defaultValue={label?.type === "label" ? label.label : ""}
            placeholder="Label name (optional)"
            className="w-44"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          An existing Gmail label is reused if the name matches; otherwise a new one is created. Reserved system
          labels (Inbox, Sent, Important, etc.) can&apos;t be targeted. Delete moves matches to Trash -- recoverable
          there, not a permanent erase. If both Archive and Delete are checked, Delete wins.
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
        <label className="text-sm font-medium">Draft a reply (AI)</label>
        <div className="flex items-center gap-2">
          <Checkbox id="action_draft" name="action_draft" defaultChecked={!!draft} />
          <label htmlFor="action_draft" className="text-sm">
            Save an AI-drafted reply to Drafts
          </label>
        </div>
        <textarea
          name="draft_instructions"
          defaultValue={draft?.type === "draft" ? draft.instructions : ""}
          placeholder="e.g. Politely decline and say I'm not available until next month."
          className="min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="text-xs text-muted-foreground">
          Never sent automatically -- saved to the Drafts folder for you to review and send yourself. Needs an LLM
          configured.
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <label className="text-sm font-medium text-destructive">Auto-reply (AI, sends immediately -- no review)</label>
        <div className="flex items-center gap-2">
          <Checkbox id="action_autoReply" name="action_autoReply" defaultChecked={!!autoReply} />
          <label htmlFor="action_autoReply" className="text-sm">
            Send an AI-drafted reply automatically
          </label>
        </div>
        <textarea
          name="autoReply_instructions"
          defaultValue={autoReply?.type === "autoReply" ? autoReply.instructions : ""}
          placeholder="e.g. Confirm receipt and say I'll respond within 2 business days."
          className="min-h-16 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span className="text-xs text-destructive">
          Sends real email on your behalf with no human review, immediately when this rule matches. Capped at
          RULES_AUTO_SEND_MAX_PER_RUN sends per run (default 20) so a large match backlog can&apos;t trigger a burst
          of sends at once. Only enable this if you understand and accept that risk.
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
        <label className="text-sm font-medium text-destructive">Auto-forward (sends immediately -- no review)</label>
        <div className="flex items-center gap-2">
          <Checkbox id="action_autoForward" name="action_autoForward" defaultChecked={!!autoForward} />
          <label htmlFor="action_autoForward" className="text-sm">
            Forward matches automatically to
          </label>
          <Input
            type="email"
            name="autoForward_to"
            defaultValue={autoForward?.type === "autoForward" ? autoForward.to : ""}
            placeholder="someone@example.com"
            className="w-56"
          />
        </div>
        <Input
          type="text"
          name="autoForward_note"
          defaultValue={autoForward?.type === "autoForward" ? (autoForward.note ?? "") : ""}
          placeholder="Note to include (optional)"
        />
        <span className="text-xs text-destructive">
          Sends real email on your behalf with no human review, immediately when this rule matches. Capped at
          RULES_AUTO_SEND_MAX_PER_RUN forwards per run (default 20).
        </span>
      </div>

      <div className="flex gap-2">
        <Button type="submit">Save</Button>
        <Button type="button" variant="outline" asChild>
          <Link href="/rules">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
