import { RuleForm } from "../RuleForm";

export default function NewRulePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">New rule</h1>
      <div className="mt-6 rounded-lg border p-6">
        <RuleForm />
      </div>
    </main>
  );
}
