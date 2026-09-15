import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getColdEmailRule, getColdEmails, getNotColdSenders, getRecentInboxMessages } from "./queries";
import { setUpColdEmailBlocker } from "./actions";
import { ColdEmailTabs } from "./ColdEmailTabs";

export const dynamic = "force-dynamic";

export default async function ColdEmailBlockerPage() {
  const rule = await getColdEmailRule();

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Cold Email Blocker</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Detects unsolicited outreach -- sales pitches, recruiting, partnership asks from strangers -- using the same
        AI rule matching as the Assistant page.
      </p>

      {!rule ? (
        <div className="mt-6 rounded-lg border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Not set up yet. This creates a rule (visible and editable from the Assistant page) with no actions
            attached -- detection only, nothing gets archived or labeled until you configure that yourself.
          </p>
          <form action={setUpColdEmailBlocker} className="mt-4">
            <Button type="submit">Set up Cold Email Blocker</Button>
          </form>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            Detection runs as part of{" "}
            <Link href="/rules" className="underline underline-offset-2">
              Assistant → Run detection now
            </Link>
            . To auto-archive or label cold emails, edit the{" "}
            <Link href={`/rules/${rule.id}/edit`} className="underline underline-offset-2">
              {rule.name}
            </Link>{" "}
            rule and add actions -- there's no separate settings UI for this, same as everything else it can catch.
          </p>

          <ColdEmailTabsSection ruleId={rule.id} accountId={rule.accountId} />
        </>
      )}
    </main>
  );
}

async function ColdEmailTabsSection({ ruleId, accountId }: { ruleId: string; accountId: string }) {
  const [coldEmails, notColdSenders, recentMessages] = await Promise.all([
    getColdEmails(ruleId),
    getNotColdSenders(accountId),
    getRecentInboxMessages(),
  ]);

  return (
    <div className="mt-6">
      <ColdEmailTabs coldEmails={coldEmails} notColdSenders={notColdSenders} recentMessages={recentMessages} />
    </div>
  );
}
