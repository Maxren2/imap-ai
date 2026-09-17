import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getAppVersion, getOAuthStatus, listLlmProviders, getDefaultLlmModel } from "./actions";
import { OAuthSettingsForm } from "./OAuthSettingsForm";
import { LlmProvidersPanel } from "./LlmProvidersPanel";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const [version, oauthStatus, providers, defaultModelId] = await Promise.all([
    getAppVersion(),
    getOAuthStatus(),
    listLlmProviders(),
    getDefaultLlmModel(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Instance Settings</h1>
        <Badge variant="outline" className="font-mono font-normal">
          v{version}
        </Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Instance-wide configuration -- OAuth apps and LLM providers. Every field here overrides the equivalent env
        var / TrueNAS YAML value when set, and applies immediately with no restart.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>LLM providers</CardTitle>
          <CardDescription>Used for AI rule matching, draft/auto-reply generation, and chat.</CardDescription>
        </CardHeader>
        <CardContent>
          <LlmProvidersPanel initialProviders={providers} initialDefaultModelId={defaultModelId} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>OAuth apps</CardTitle>
          <CardDescription>Google and Microsoft credentials used for mail and calendar linking.</CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthSettingsForm initial={oauthStatus} />
        </CardContent>
      </Card>

      <p className="mt-6 text-xs text-muted-foreground">
        CREDENTIAL_ENCRYPTION_KEY (the key everything on this page is encrypted with) is never shown or settable
        here -- it can only come from the environment, by design.
      </p>
    </main>
  );
}
