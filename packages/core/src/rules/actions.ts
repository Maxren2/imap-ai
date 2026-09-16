import { z } from "zod";
import type { ImapFlow } from "imapflow";
import { resolveOrCreateLabel } from "../labels";
import { findSpecialUseMailbox } from "../special-use";

// Deliberately a small subset of inbox-zero's action types (LABEL, ARCHIVE,
// REPLY, FORWARD, DRAFT_EMAIL, MARK_SPAM, DELETE, ...). Label/archive/
// markRead/star/delete are all non-sending, reversible-in-spirit moves
// (delete moves to Trash, not a permanent expunge -- recoverable the same
// way archive is). Reply/forward/draft are a different, meaningfully
// riskier class -- composing and *sending* real content automatically
// when a rule matches, with no human review in the loop -- and stay
// deliberately deferred as *rule* actions even though manual, user-
// composed reply/forward now exist elsewhere in the app (mail-actions.ts's
// replyToThread/forwardMessage): a person clicking Send on their own
// words is a different risk profile than a rule silently emailing
// someone on your behalf.
export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("label"), label: z.string().min(1) }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("markRead") }),
  z.object({ type: z.literal("star") }),
  z.object({ type: z.literal("delete") }),
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
 * Archive/delete are always applied last, regardless of the order given
 * in `actions`, and via a different mechanism than label add/remove:
 * Gmail's IMAP server silently no-ops `-X-GM-LABELS (\Inbox)` (returns
 * "OK Success" but doesn't apply it -- confirmed live, not documented
 * anywhere obvious), so archiving instead MOVEs the message to the
 * SPECIAL-USE \All folder, and delete MOVEs it to \Trash the same way
 * (not a permanent expunge -- still sitting in Trash, recoverable, same
 * "reversible" spirit as archive). Either move changes the message's UID,
 * which would break any action run after it against the old UID in this
 * mailbox -- hence doing it last no matter what order the caller
 * specified. If a rule somehow specifies both archive and delete, delete
 * wins (moving to Trash already removes it from the inbox, an archive
 * move afterward would be both redundant and racing against a UID that
 * no longer exists there).
 */
export async function applyRuleActions(client: ImapFlow, uid: number, actions: RuleActions): Promise<void> {
  const range = { uid: String(uid) };
  const willDelete = actions.some((action) => action.type === "delete");
  const willArchive = !willDelete && actions.some((action) => action.type === "archive");

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
      case "delete":
        break; // handled after the loop, see above
    }
  }

  if (willDelete) {
    const trashPath = await findSpecialUseMailbox(client, "\\Trash");
    if (!trashPath) {
      throw new Error("Could not find the Trash folder via SPECIAL-USE; cannot delete.");
    }
    await client.messageMove(range, trashPath, { uid: true });
  } else if (willArchive) {
    const allMailPath = await findSpecialUseMailbox(client, "\\All");
    if (!allMailPath) {
      throw new Error("Could not find the All Mail folder via SPECIAL-USE; cannot archive.");
    }
    await client.messageMove(range, allMailPath, { uid: true });
  }
}
