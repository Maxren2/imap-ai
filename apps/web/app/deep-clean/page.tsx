import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeepCleanForm } from "./DeepCleanForm";
import { getLatestDeepCleanRuns } from "./actions";

export const dynamic = "force-dynamic";

export default async function DeepCleanPage() {
  const initialRuns = await getLatestDeepCleanRuns();

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Deep Clean</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Bulk-archive or mark-as-read everything in your inbox older than a chosen age, skipping mail you'd rather
        keep visible. Deterministic only (no AI step) -- a rule cascade over what's already synced locally, same as
        the rest of this app.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Configure a run</CardTitle>
          <CardDescription>Preview the count before running -- nothing is touched until you click Run.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeepCleanForm initialRuns={initialRuns} />
        </CardContent>
      </Card>
    </main>
  );
}
