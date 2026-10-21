import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { getPayoutReceipt } from "@/server/domain/caixa/payouts";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";
import { PayoutReceipt } from "@/components/caixa/payout-receipt";
import { PrintButton, RECIBO_PRINT_CSS } from "@/components/caixa/print-button";
import { UndoPayout } from "@/components/caixa/payouts-list";

export const metadata = { title: "Recibo" };

/**
 * O recibo do pagamento da comissão, em página própria para imprimir. Quem vê a comissão (comissao.ver) ou paga (comissao.pagar) abre;
 * só quem paga desfaz. Continua com "Pagar a comissão" desligado (ver e desfazer não dependem do liga/desliga).
 */
export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireAnyPerm("comissao.ver", "comissao.pagar");
  const { id } = await params;
  const [r, recursos] = await Promise.all([getPayoutReceipt(id), getCaixaRecursos()]);
  if (!r) notFound();
  return (
    <main className="px-5 pb-12 pt-5 lg:px-8">
      <style>{RECIBO_PRINT_CSS}</style>
      <Link href="/caixa/comissao?aba=pagas" className="mb-4 inline-flex min-h-11 items-center text-sm font-medium text-graphite hover:text-ink lg:min-h-0 print:hidden">‹ Comissão</Link>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <div className="recibo-print"><PayoutReceipt receipt={r} reciboTexto={recursos.reciboTexto} /></div>
        <div className="flex flex-wrap items-start gap-2 print:hidden">
          <PrintButton />
          {can(user.perms, "comissao.pagar") && !r.cancelledAt && <UndoPayout id={r.id} />}
        </div>
      </div>
    </main>
  );
}
