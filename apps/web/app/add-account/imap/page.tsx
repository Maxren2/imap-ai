import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AddImapAccountForm } from "./AddImapAccountForm";

export default function AddImapAccountPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <Link href="/add-account" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Add an IMAP account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Works with any provider that supports IMAP -- Fastmail, a corporate mailbox, etc. The connection is tested
        before anything is saved.
      </p>
      <div className="mt-6 rounded-lg border p-6">
        <AddImapAccountForm />
      </div>
    </main>
  );
}
