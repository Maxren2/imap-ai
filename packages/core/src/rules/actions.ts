import { z } from "zod";
import type { ImapFlow } from "imapflow";
import { resolveOrCreateLabel } from "../labels";
import { findSpecialUseMailbox } from "../special-use";

// label/archive/markRead/star/delete are all non-sending, reversible-in-
// spirit moves (delete moves to Trash, not a permanent expunge --
// recoverable the same way archive is) -- handled entirely by
// applyRuleActions below, given just an IMAP client and a uid.
//
// draft/autoReply/autoForward are a different, meaningfully riskier class:
// composing (and, for autoReply/autoForward, actually *sending*) real
// content automatically when a rule matches. These were deliberately
// deferred for a long time -- until the person running this app explicitly
// asked for them, aware of that risk, after manual (user-composed,
// user-clicks-Send) reply/forward already existed as the lower-risk
// option. They are NOT handled by applyRuleActions (which only ever gets
// an ImapFlow + uid, not the SMTP transport / AI config / full message
// content these need) -- see rules/sending-actions.ts's applySendingActions
// and RULES_AUTO_SEND_MAX_PER_RUN's per-run cap in rules/apply-actions.ts,
// which bounds how many real sends one run can trigger so a
// misconfigured rule with a huge match backlog can't blast out thousands
// of emails in one pass.
//   - draft: AI drafts a reply from `instructions` + the message, saved to
//     the Drafts folder -- never sent automatically, a human still has to
//     open it and click Send in their real mail client.
//   - autoReply: same AI-drafted reply, but actually sent immediately, no
//     human review.
//   - autoForward: forwards the matched message (quoted, like manual
//     forward) to a fixed `to` address, with an optional static `note`.
//     No AI involved -- deterministic, like label/archive.
export const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("label"), label: z.string().min(1) }),
  z.object({ type: z.literal("archive") }),
  z.object({ type: z.literal("markRead") }),
  z.object({ type: z.literal("star") }),
  z.object({ type: z.literal("delete") }),
  z.object({ type: z.literal("draft"), instructions: z.string().min(1) }),
  z.object({ type: z.literal("autoReply"), instructions: z.string().min(1) }),
  z.object({ type: z.literal("autoForward"), to: z.string().email(), note: z.string().optional() }),
]);

export type RuleAction = z.infer<typeof ruleActionSchema>;

export const ruleActionsSchema = z.array(ruleActionSchema).min(1);
export type RuleActions = z.infer<typeof ruleActionsSchema>;

export function parseRuleActions(raw: unknown): RuleActions {
  return ruleActionsSchema.parse(raw);
}

/** draft/autoReply/autoForward need SMTP/AI/full-message context applyRuleActions doesn't have -- see rules/sending-actions.ts. */
export function isSendingAction(action: RuleAction): boolean {
  return action.type === "draft" || action.type === "autoReply" || action.type === "autoForward";
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
 *
 * Throws if given a draft/autoReply/autoForward action -- those need an
 * SMTP transport, AI config, and full message content this function
 * doesn't have (see isSendingAction/rules/sending-actions.ts); a caller
 * passing one here is a bug, not something to silently ignore.
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
      case "draft":
      case "autoReply":
      case "autoForward":
        throw new Error(`applyRuleActions cannot handle a "${action.type}" action -- use applySendingActions instead.`);
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
