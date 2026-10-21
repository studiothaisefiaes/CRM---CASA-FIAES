import Link from "next/link";
import { db } from "@/server/db";
import { can } from "@/lib/permissions";
import { getCaixaMode } from "@/server/domain/caixa/mode";
import { getOpenCashTx } from "@/server/domain/caixa/cash";
import { buttonClass } from "@/components/ui/button-styles";

/** A faixa (psico r68 #6): discreta, uma linha, com o caminho de 1 clique. Pura, para o teste. */
export function CashClosedStrip({ className }: { className?: string }) {
  return (
    <div role="status" className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] bg-gold-soft px-4 py-2 ${className ?? ""}`}>
      <p className="text-sm text-ink">O caixa está fechado. O que for recebido antes de abrir fica sem caixa.</p>
      <Link href="/caixa" className={buttonClass({ variant: "gold", size: "sm" })}>Abrir caixa</Link>
    </div>
  );
}

/**
 * Hoje e Agenda lembram que o SEU caixa está fechado (psico r68 #6), só para quem opera o caixa e com o caixa no CRM. Caixa aberto: nada.
 */
export async function CashClosedNotice({ user, className }: { user: { id: string; perms: readonly string[] }; className?: string }) {
  if (!can(user.perms, "caixa.operar")) return null;
  if ((await getCaixaMode()) !== "crm") return null;
  if (await getOpenCashTx(db, user.id)) return null;
  return <CashClosedStrip className={className} />;
}
