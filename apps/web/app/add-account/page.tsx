import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listEmailAccounts } from "@/lib/session";
import { logout } from "@/app/logout-action";
import { RemoveAccountButton } from "./RemoveAccountButton";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  google_not_configured: "Gmail isn't set up on this instance yet -- GOOGLE_CLIENT_ID/SECRET aren't configured.",
  microsoft_not_configured: "Outlook isn't set up on this instance yet -- MICROSOFT_CLIENT_ID isn't configured.",
  invalid_state: "That connection attempt expired or was invalid. Try again.",
  no_refresh_token: "Didn't get a usable refresh token back. Try again, or revoke this app's access in your account's security settings first.",
  no_email: "Couldn't determine the mailbox's email address from the sign-in response.",
  token_exchange_failed: "The connection to the provider failed. Try again.",
};

export default async function AddAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [accounts, { error }] = await Promise.all([listEmailAccounts(), searchParams]);

  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add an account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Link a mailbox to read and act on over IMAP. You can link more than one -- Gmail, Outlook, and any other
            IMAP-capable provider.
          </p>
        </div>
        <form action={logout}>
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      {error && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {ERROR_MESSAGES[error] ?? "Something went wrong connecting that account."}
        </p>
      )}

      {accounts.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-muted-foreground">Your linked mailboxes</h2>
          <div className="mt-2 grid gap-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm">{account.email}</span>
                  <Badge variant="outline" className="font-normal capitalize">
                    {account.provider}
                  </Badge>
                </div>
                <RemoveAccountButton accountId={account.id} email={account.email} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Gmail</CardTitle>
              <CardDescription>Sign in with Google to grant IMAP/SMTP access.</CardDescription>
            </div>
            <Button asChild>
              <a href="/api/connect/google">
                Connect <ArrowRight />
              </a>
            </Button>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Outlook</CardTitle>
              <CardDescription>Sign in with Microsoft to grant IMAP/SMTP access.</CardDescription>
            </div>
            <Button asChild>
              <a href="/api/connect/microsoft">
                Connect <ArrowRight />
              </a>
            </Button>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base">Other IMAP</CardTitle>
              <CardDescription>Fastmail, a corporate mailbox, or anything else with IMAP.</CardDescription>
            </div>
            <Button asChild variant="outline">
              <Link href="/add-account/imap">
                <Mail /> Set up
              </Link>
            </Button>
          </CardHeader>
        </Card>
      </div>

      {accounts.length > 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-4">
            Back to your inbox
          </Link>
        </p>
      )}
    </main>
  );
}
