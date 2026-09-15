import { z } from "zod";
import type { ImapFlow } from "imapflow";
import { resolveOrCreateLabel } from "../labels";
import { findSpecialUseMailbox } from "../special-use";

// Deliberately a small subset of inbox-zero's action types (LABEL, ARCHIVE,
// REPLY, FORWARD, DRAFT_EMAIL, MARK_SPAM, DELETE, ...) -- these four are
// the safe, reversible, non-sending ones. Reply/forward/draft/delete are
// meaningfully more complex (composing content, guarding against
// destructive mistakes) and deliberately deferred.
export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("label"), label: z.string().min(1) }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("markRead") }),
  z.object({ type: z.literal("star") }),
]);

export type RuleAction = z.infer<typeof ruleActionSchema>;

export const ruleActionsSchema = z.array(ruleActionSchema).min(1);
export type RuleActions = z.infer<typeof ruleActionsSchema>;

export function parseRuleActions(raw: unknown): RuleActions {
  return ruleActionsSchema.parse(raw);
}

/**
 * Applies a rule's actions to one message. Assumes the caller holds a lock
 * on the mailbox the message's uid belongs to (INBOX for the whole app
 * right now). Gmail label mutations go through the IMAP X-GM-LABELS
 * extension (messageFlagsAdd with useLabels: true), not folder moves --
 * that's what actually adds a label without touching the message's other
 * labels.
 *
 * Archive is always applied last, regardless of the order given in
 * `actions`, and via a different mechanism than label add/remove: Gmail's
 * IMAP server silently no-ops `-X-GM-LABELS (\Inbox)` (returns "OK
 * Success" but doesn't apply it -- confirmed live, not documented
 * anywhere obvious), so archiving instead MOVEs the message to the
 * SPECIAL-USE \All folder. That changes the message's UID, which would
 * break any action run after it against the old UID in this mailbox --
 * hence doing it last no matter what order the caller specified.
 */
export async function applyRuleActions(client: ImapFlow, uid: number, actions: RuleActions): Promise<void> {
  const range = { uid: String(uid) };
  const willArchive = actions.some((action) => action.type === "archive");

  for (const action of actions) {
    switch (action.type) {
      case "label": {
        const labelName = await resolveOrCreateLabel(client, action.label);
        await client.messageFlagsAdd(range, [labelName], { uid: true, useLabels: true });
        break;
      }
      case "markRead":
        await client.messageFlagsAdd(range, ["\\Seen"], { uid: true });
        break;
      case "star":
        await client.messageFlagsAdd(range, ["\\Flagged"], { uid: true });
        break;
      case "archive":
        break; // handled after the loop, see above
    }
  }

  if (willArchive) {
    const allMailPath = await findSpecialUseMailbox(client, "\\All");
    if (!allMailPath) {
      throw new Error("Could not find the All Mail folder via SPECIAL-USE; cannot archive.");
    }
    await client.messageMove(range, allMailPath, { uid: true });
  }
}
