import { AddImapAccountForm } from "./AddImapAccountForm";

export default function AddImapAccountPage() {
  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Add an IMAP account</h1>
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
