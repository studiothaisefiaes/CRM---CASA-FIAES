"use client";
import { useComanda } from "./comanda-provider";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ComandaListRow } from "@/server/queries/comandas-list";

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dayLabel = (d: string) => DM.format(new Date(`${d}T12:00:00Z`));
export const SITUACAO: Record<string, { label: string; cls: string }> = {
  aberta: { label: "Aberta", cls: "bg-gold-soft text-gold-ink" }, fechada: { label: "Paga", cls: "bg-ok-soft text-ok" }, cancelada: { label: "Cancelada", cls: "bg-paper-2 text-muted" },
};

/** As linhas do histórico de comandas (Caixa › Comandas e a ficha da cliente): tocar abre a comanda quando há o provider (caixa.operar). */
export function ComandasList({ rows, total, showClient = true }: { rows: ComandaListRow[]; total?: number; showClient?: boolean }) {
  const comanda = useComanda();
  if (!rows.length) return <p className="text-sm text-muted">Nenhuma comanda com esses filtros.</p>;
  return (
    <div className="flex flex-col gap-2">
      {total != null && total > rows.length && <p role="status" className="text-sm text-graphite">Mostrando {rows.length} de {total}: refine a busca ou o período.</p>}
      <ul aria-label="Comandas" className="divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
        {rows.map((r) => {
          const s = r.debtCents > 0 ? { label: `Deve ${money(r.debtCents)}`, cls: "bg-alert-soft text-alert" }
            : r.hasDebt ? { label: "Com dívida", cls: "bg-alert-soft text-alert" } : SITUACAO[r.status] ?? SITUACAO.aberta;
          const body = (
            <>
              <span className="w-16 shrink-0 text-sm text-graphite tabular-nums">{dayLabel(r.day)}<span className="block text-xs text-muted">nº {r.number}</span></span>
              <span className="min-w-0 flex-1">
                {showClient && <span className="block truncate font-medium text-ink">{r.clientName}</span>}
                <span className="block truncate text-sm text-graphite">{r.professionals.length ? r.professionals.join(", ") : "Sem profissional"}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block tabular-nums">{r.totalCents == null ? "—" : money(r.totalCents)}</span>
                <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium", s.cls)}>{s.label}</span>
              </span>
            </>
          );
          return (
            <li key={r.id}>
              {comanda ? (
                <button type="button" onClick={() => comanda.openById(r.id)} aria-label={`Abrir comanda ${r.number} de ${dayLabel(r.day)} · ${r.clientName}`}
                  className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-paper-2/60">{body}</button>
              ) : <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">{body}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
