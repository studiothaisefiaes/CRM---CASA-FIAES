import { money } from "@/lib/format";
import { brDay, type SalonRange } from "@/lib/salon-period";
import type { ExceptionKind, FinanceException } from "@/server/reports/financeiro";
import { EXCEPTION_LABEL, exceptionCounts } from "@/server/reports/financeiro/excecoes";
import { DataList, type Col } from "./data-list";
import { Muted } from "./section";
import { SalonPeriodPicker } from "./salon-period-picker";
import { ExcecoesTipo } from "./excecoes-tipo";

const brl = (c: number | null) => (c == null ? "—" : money(c));
const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export type ExceptionRow = FinanceException & { k: string };
/** Colunas da lista de exceções: a do resumo do Financeiro e a da página própria são a mesma. */
export const exceptionCols: Col<ExceptionRow>[] = [
  { key: "t", label: "O quê", render: (x) => EXCEPTION_LABEL[x.kind] },
  { key: "d", label: "Quando", render: (x) => (x.at ? when(x.at) : brDay(x.day).slice(0, 5)) },
  { key: "c", label: "Comanda", render: (x) => [x.comanda && `Nº ${x.comanda}`, x.client, x.item].filter(Boolean).join(" · ") || "—" },
  { key: "q", label: "Quem fez", render: (x) => x.who ?? (x.origin === "avec" ? "Avec" : "—") },
  { key: "v", label: "Valor", align: "right", render: (x) => (x.beforeCents != null && x.afterCents != null ? `${money(x.beforeCents)} → ${money(x.afterCents)}` : brl(x.valueCents)) },
  { key: "m", label: "Motivo", render: (x) => x.reason ?? (x.origin === "crm" ? <span className="text-gold-ink">sem motivo registrado</span> : "—") },
];
export const withKeys = (list: FinanceException[]): ExceptionRow[] => list.map((x, i) => ({ ...x, k: `${i}` }));

/** Página /relatorios/excecoes: a lista inteira do período, filtrada por tipo. Sem corte: o resumo do Financeiro é que mostra só as mais recentes. */
export function ExcecoesPage({ range, exceptions, tipo }: { range: SalonRange; exceptions: FinanceException[]; tipo: ExceptionKind | null }) {
  const counts = exceptionCounts(exceptions);
  const shown = withKeys(tipo ? exceptions.filter((x) => x.kind === tipo) : exceptions);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SalonPeriodPicker preset={range.preset} from={range.from} to={range.to} path="/relatorios/excecoes" keep={tipo ? { tipo } : undefined} />
        <ExcecoesTipo value={tipo} options={counts.map((c) => ({ kind: c.kind, label: `${c.label} (${c.count})` }))} extra={tipo && !counts.some((c) => c.kind === tipo) ? { kind: tipo, label: `${EXCEPTION_LABEL[tipo]} (0)` } : null} />
      </div>
      {shown.length === 0 ? <Muted>Nenhuma exceção{tipo ? " desse tipo" : ""} no período.</Muted>
        : <DataList rows={shown} cols={exceptionCols} rowKey={(x) => x.k} caption="Exceções" />}
    </div>
  );
}
