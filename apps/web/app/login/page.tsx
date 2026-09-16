import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
            i
          </div>
          <span className="font-semibold">imap-ai</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="mt-4 text-sm text-muted-foreground">
          No account yet?{" "}
          <a href="/signup" className="text-foreground underline underline-offset-4">
            Sign up
          </a>
        </p>
      </div>
    </main>
  );
}
