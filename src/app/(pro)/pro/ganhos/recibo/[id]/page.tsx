import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePerm } from "@/server/auth/session";
import { resolvePro } from "@/server/queries/pro";
import { getProReceipt } from "@/server/queries/pro-earnings";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";
import { PayoutReceipt } from "@/components/caixa/payout-receipt";
import { PrintButton, RECIBO_PRINT_CSS } from "@/components/caixa/print-button";

export const metadata = { title: "Recibo" };

/** Um recibo dela (`pro.ganhos`). Recibo de outra profissional ou que não existe: notFound. */
export default async function ProReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePerm("pro.ganhos");
  const pro = await resolvePro(user.id);
  if (!pro) notFound();
  const { id } = await params;
  const [r, recursos] = await Promise.all([getProReceipt(pro, id), getCaixaRecursos()]);
  if (!r) notFound();
  return (
    <main className="flex flex-col gap-3">
      <style>{RECIBO_PRINT_CSS}</style>
      <Link href="/pro/ganhos" className="inline-flex min-h-11 items-center text-sm font-medium text-gold-ink print:hidden">‹ Ganhos</Link>
      <div className="recibo-print"><PayoutReceipt receipt={r} reciboTexto={recursos.reciboTexto} /></div>
      <div className="print:hidden"><PrintButton /></div>
    </main>
  );
}
