import { prisma } from "@imap-ai/core/db";
import { notFound } from "next/navigation";
import { RuleForm } from "../../RuleForm";

export const dynamic = "force-dynamic";

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rule = await prisma.rule.findUnique({ where: { id } });
  if (!rule) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Edit rule</h1>
      <div className="mt-6 rounded-lg border p-6">
        <RuleForm rule={rule} />
      </div>
    </main>
  );
}
