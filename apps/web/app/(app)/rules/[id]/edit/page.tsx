import { prisma } from "@imap-ai/core/db";
import { notFound } from "next/navigation";
import { RuleForm } from "../../RuleForm";
import { ResetProgressButton } from "../../ResetProgressButton";
import { getActiveEmailAccount } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await getActiveEmailAccount();
  const rule = await prisma.rule.findFirst({ where: { id, accountId: account.id }, include: { _count: { select: { matches: true } } } });
  if (!rule) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Edit rule</h1>
      <div className="mt-6 rounded-lg border p-6">
        <RuleForm rule={rule} />
      </div>
      <div className="mt-6 flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Reprocess already-checked mail</p>
          <p className="text-xs text-muted-foreground">
            rules:run never re-checks a message it's already matched or (for AI rules) already evaluated -- useful
            after changing this rule's conditions or AI prompt and wanting it to reconsider everything.
          </p>
        </div>
        <ResetProgressButton ruleId={rule.id} matchCount={rule._count.matches} />
      </div>
    </main>
  );
}
