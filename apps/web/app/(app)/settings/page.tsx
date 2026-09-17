import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSyncDepth, getSettingsBackgroundRuns, getAvailability } from "./actions";
import { SyncDepthForm } from "./SyncDepthForm";
import { AvailabilityForm } from "./AvailabilityForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [syncDepth, backgroundRuns, availability] = await Promise.all([
    getSyncDepth(),
    getSettingsBackgroundRuns(),
    getAvailability(),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Personal preferences for how mail syncs and how scheduling replies get drafted.</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Mail sync depth</CardTitle>
          <CardDescription>How much history to keep synced for the active mailbox.</CardDescription>
        </CardHeader>
        <CardContent>
          <SyncDepthForm initial={syncDepth} initialRuns={backgroundRuns} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Availability</CardTitle>
          <CardDescription>Your weekly availability window for scheduling replies.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvailabilityForm initial={availability} />
        </CardContent>
      </Card>
    </main>
  );
}
