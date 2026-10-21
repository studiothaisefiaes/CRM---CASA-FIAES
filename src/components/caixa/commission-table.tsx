import Link from "next/link";
import type { CommissionLine, CommissionReport } from "@/server/domain/caixa/commission";
import { bpToPercent } from "@/lib/comanda-math";
import { money } from "@/lib/format";
import { Empty } from "@/components/ui/empty";

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const DEDUCT_NAME = { cartao: "Taxa do cartão", antecipacao: "Antecipação", custo: "Custo do serviço", assistentes: "Assistente" } as const;
/** Soma e detalhe dos descontos do retrato; sem retrato (comanda de antes da Fase A) = traço. */
function Deducted({ d }: { d: CommissionLine["deductions"] }) {
  if (!d) return <>—</>;
  const parts = (Object.keys(DEDUCT_NAME) as (keyof typeof DEDUCT_NAME)[]).filter((k) => d[k] > 0);
  if (!parts.length) return <>—</>;
  return <span title={parts.map((k) => `${DEDUCT_NAME[k]} ${money(d[k])}`).join(" · ")}>{`− ${money(parts.reduce((a, k) => a + d[k], 0))}`}</span>;
}
const PEND = { sem_regra: "Sem regra", sem_valor_sessao: "Valor da sessão não definido", aguardando_quitacao: "Espera a cliente quitar a dívida", ok: "" } as const;

/** Relatório Comissão (7.1): por profissional, as linhas com base, % e valor; pendências à parte, sem somar. Linha paga: o recibo, que abre. */
export function CommissionTable({ report }: { report: CommissionReport }) {
  if (!report.rows.length) return <Empty title="Nenhuma comissão no período">Só entram comandas fechadas no CRM.</Empty>;
  return (
    <div className="flex flex-col gap-5">
      {report.pending > 0 && <p className="rounded-[var(--radius-control)] bg-gold-soft/60 px-3 py-2 text-sm text-gold-ink">{`${report.pending} ${report.pending === 1 ? "linha sem regra ou sem valor da sessão" : "linhas sem regra ou sem valor da sessão"}: preencha em Regras ou em Pacotes.`}</p>}
      {/* Retidas pela dívida não pedem nada da gestão: entram sozinhas quando a cliente quitar. */}
      {report.held > 0 && <p className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">{report.held === 1 ? "1 linha espera a cliente quitar a dívida: entra na comissão quando ela pagar." : `${report.held} linhas esperam a cliente quitar a dívida: entram na comissão quando ela pagar.`}</p>}
      {report.rows.map((r) => (
        <section key={r.professionalId} aria-label={`Comissão de ${r.name}`} className="rounded-[var(--radius-card)] border border-line bg-paper">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="font-semibold">{r.name}{!r.active && <span className="ml-2 text-xs font-normal text-muted">desativada</span>}</h2>
            <p className="text-sm tabular">Base {money(r.baseCents)} · <span className="font-semibold">Comissão {money(r.commissionCents)}</span></p>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-left text-muted"><th className="px-4 py-2 font-medium">Dia</th><th className="font-medium">Comanda</th><th className="font-medium">Cliente</th><th className="font-medium">Item</th><th className="font-medium">Base</th><th className="font-medium">%</th><th className="font-medium">Bruta</th><th className="font-medium">Descontos</th><th className="pr-4 font-medium">Comissão</th></tr></thead>
              <tbody>
                {r.lines.map((l) => (
                  <tr key={l.assistantId ?? l.itemId} className="border-t border-line/70">
                    <td className="px-4 py-2 tabular">{DM.format(new Date(`${l.day}T12:00:00Z`))}</td><td className="tabular">{l.comandaNumber}</td><td>{l.clientName}</td><td>{l.label}</td>
                    <td className="tabular">{l.baseCents == null ? "—" : money(l.baseCents)}</td><td className="tabular">{l.bp == null ? "—" : `${bpToPercent(l.bp)}%`}</td>
                    <td className="tabular">{l.grossCents == null ? "—" : money(l.grossCents)}</td><td className="tabular"><Deducted d={l.deductions} /></td>
                    <td className="pr-4 tabular">{l.status === "ok" ? money(l.commissionCents) : <span className="text-gold-ink">{PEND[l.status]}</span>}
                      {l.payoutId && <Link href={`/caixa/comissao/recibo/${l.payoutId}`} className="ml-2 text-xs text-gold-ink underline underline-offset-4">{`Recibo nº ${l.payoutNumber}`}</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
