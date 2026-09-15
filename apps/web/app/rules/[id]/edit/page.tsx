import { prisma } from "@imap-ai/core/db";
import { notFound } from "next/navigation";
import { RuleForm } from "../../RuleForm";

export const dynamic = "force-dynamic";

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rule = await prisma.rule.findUnique({ where: { id } });
  if (!rule) notFound();

  return (
    <main>
      <h1>Edit rule</h1>
      <div className="card">
        <RuleForm rule={rule} />
      </div>
    </main>
  );
}
