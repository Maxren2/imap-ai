import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            i
          </div>
          <span className="font-semibold">imap-ai</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Self-hosted -- anyone who can reach this page can create an account. Keep this instance off the open
          internet if that's not what you want.
        </p>
        <SignupForm />
        <p className="mt-4 text-sm text-muted-foreground">
          Already have an account?{" "}
          <a href="/login" className="text-foreground underline underline-offset-4">
            Log in
          </a>
        </p>
      </div>
    </main>
  );
}
