"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addImapAccount, type FormState } from "./actions";

const initialState: FormState = {};

function Field({ id, label, ...props }: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input id={id} name={id} {...props} />
    </div>
  );
}

export function AddImapAccountForm() {
  const [state, formAction, isPending] = useActionState(addImapAccount, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field id="email" label="Email address" type="email" required />
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field id="imapHost" label="IMAP host" type="text" placeholder="imap.example.com" required />
        </div>
        <Field id="imapPort" label="Port" type="number" defaultValue={993} required />
      </div>
      <Field id="imapUser" label="IMAP username (if different from email)" type="text" />
      <Field id="password" label="Password" type="password" autoComplete="off" required />
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field id="smtpHost" label="SMTP host (optional, for unsubscribe emails)" type="text" placeholder="smtp.example.com" />
        </div>
        <Field id="smtpPort" label="Port" type="number" placeholder="587" />
      </div>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Testing connection..." : "Test & add account"}
      </Button>
    </form>
  );
}
