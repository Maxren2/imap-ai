import { prisma } from "@imap-ai/core/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getVolumeOverTime, getTopSenders, getRuleStats, getCategoryBreakdown, getSenderCategories } from "./queries";
import { VolumeChart } from "./VolumeChart";
import { TopSendersChart } from "./TopSendersChart";
import { RuleStatsChart } from "./RuleStatsChart";
import { CategoryChart } from "./CategoryChart";
import { SenderCategoryTable } from "./SenderCategoryTable";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const account = await prisma.account.findFirstOrThrow();
  const [volume, topSenders, ruleStats, categories, senderCategories] = await Promise.all([
    getVolumeOverTime(),
    getTopSenders(10),
    getRuleStats(),
    getCategoryBreakdown(account.id),
    getSenderCategories(account.id),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Computed entirely from your local synced mail mirror -- no live Gmail calls at page load.
      </p>

      <div className="mt-6 grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Mail volume (last 90 days)</CardTitle>
            <CardDescription>Received vs. sent, by day.</CardDescription>
          </CardHeader>
          <CardContent>
            {volume.length > 0 ? (
              <VolumeChart data={volume} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No mail in the last 90 days.</p>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Top senders</CardTitle>
              <CardDescription>By message count, excluding mail you sent.</CardDescription>
            </CardHeader>
            <CardContent>
              {topSenders.length > 0 ? (
                <TopSendersChart senders={topSenders} />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No senders yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sender categories</CardTitle>
              <CardDescription>Heuristic classification of your top 300 senders.</CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryChart rows={categories} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sender categories (hand-correct)</CardTitle>
            <CardDescription>
              Fix a wrong guess by picking a different category -- it sticks, overriding the heuristic for that sender
              going forward.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SenderCategoryTable rows={senderCategories} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rule matches</CardTitle>
            <CardDescription>How many messages each rule has matched so far.</CardDescription>
          </CardHeader>
          <CardContent>
            {ruleStats.length > 0 ? (
              <RuleStatsChart rules={ruleStats} />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No rules yet -- create one on the Assistant page.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
