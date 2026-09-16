import Link from "next/link";
import { Mail, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listEmailAccounts } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AddAccountPage() {
  const accounts = await listEmailAccounts();

  return (
    <main className="mx-auto max-w-xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Add an account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Link a mailbox to read and act on over IMAP. You can link more than one -- Gmail, Outlook, and any other
        IMAP-capable provider.
      </p>

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
