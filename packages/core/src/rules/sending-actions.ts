import type { ImapFlow } from "imapflow";
import type { Transporter } from "nodemailer";
import { saveDraft, sendAndSaveToSent } from "../smtp.js";
import { replySubject, forwardSubject, buildForwardBody } from "../mail-format.js";
import { generateReplyDraft } from "../ai/ollama.js";
import type { LlmConfig } from "../ai/llm-config.js";
import type { RuleAction } from "./actions.js";

export interface SendingActionMessage {
  subject: string | null;
  fromAddress: string | null;
  fromName: string | null;
  toAddress: string | null;
  date: Date;
  messageIdHeader: string | null;
  bodyText: string | null;
  labels: string[];
}

export interface SendingActionContext {
  imapClient: ImapFlow;
  smtpTransport: Transporter;
  fromEmail: string;
  ollamaConfig: LlmConfig | undefined;
  // See calendar/availability.ts's buildAvailabilityContext -- undefined
  // when the account owner has no calendar connected.
  availabilityContext: string | undefined;
}

function replyRecipient(message: SendingActionMessage, fromEmail: string): string {
  // Same "reply to whichever party isn't us" logic as the manual reply
  // path (apps/web/app/mail-actions.ts's replyToThread) -- a rule can
  // match a message the account itself sent (e.g. still in a No-Reply-
  // style thread), and replying to its own fromAddress would just email
  // itself.
  const isSentByMe = message.labels.includes("\\Sent") || message.fromAddress === fromEmail;
  const to = isSentByMe ? message.toAddress : message.fromAddress;
  if (!to) throw new Error("No recipient address found to reply to.");
  return to;
}

/**
 * Executes a rule's draft/autoReply/autoForward actions against one
 * already-matched message -- the sibling of applyRuleActions (actions.ts)
 * for the action types that need more than just an ImapFlow + uid: an
 * SMTP transport (autoReply/autoForward), AI config (draft/autoReply),
 * and full message content (all three, for the reply/quote body). Callers
 * decide which matches even reach this function -- see
 * rules/apply-actions.ts's per-rule-per-run RULES_AUTO_SEND_MAX_PER_RUN
 * cap, the actual safety rail against a misconfigured rule sending
 * hundreds of real emails in one run.
 */
export async function applySendingActions(
  ctx: SendingActionContext,
  message: SendingActionMessage,
  actions: RuleAction[],
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "draft": {
        if (!ctx.ollamaConfig) throw new Error("The draft action needs an LLM configured (see /admin/settings).");
        const to = replyRecipient(message, ctx.fromEmail);
        const text = await generateReplyDraft(ctx.ollamaConfig, {
          instructions: action.instructions,
          subject: message.subject,
          fromAddress: message.fromAddress,
          fromName: message.fromName,
          body: message.bodyText,
          availabilityContext: ctx.availabilityContext,
        });
        await saveDraft(ctx.imapClient, ctx.fromEmail, {
          to,
          subject: replySubject(message.subject),
          text,
          inReplyTo: message.messageIdHeader || undefined,
          references: message.messageIdHeader || undefined,
        });
        break;
      }
      case "autoReply": {
        if (!ctx.ollamaConfig) throw new Error("The auto-reply action needs an LLM configured (see /admin/settings).");
        const to = replyRecipient(message, ctx.fromEmail);
        const text = await generateReplyDraft(ctx.ollamaConfig, {
          instructions: action.instructions,
          subject: message.subject,
          fromAddress: message.fromAddress,
          fromName: message.fromName,
          body: message.bodyText,
          availabilityContext: ctx.availabilityContext,
        });
        await sendAndSaveToSent(ctx.smtpTransport, ctx.imapClient, ctx.fromEmail, {
          to,
          subject: replySubject(message.subject),
          text,
          inReplyTo: message.messageIdHeader || undefined,
          references: message.messageIdHeader || undefined,
        });
        break;
      }
      case "autoForward": {
        const quoted = buildForwardBody(message, message.bodyText, action.note ?? "");
        await sendAndSaveToSent(ctx.smtpTransport, ctx.imapClient, ctx.fromEmail, {
          to: action.to,
          subject: forwardSubject(message.subject),
          text: quoted,
        });
        break;
      }
      default:
        throw new Error(`applySendingActions cannot handle a "${action.type}" action.`);
    }
  }
}
