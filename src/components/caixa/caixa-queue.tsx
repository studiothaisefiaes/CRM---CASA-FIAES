"use client";
import { Fragment, useState, type ReactNode } from "react";
import type { CaixaQueue, QueueRow } from "@/server/queries/caixa";
import { Menu } from "@/components/ui/menu";
import { CancelComandaDialog } from "./cancel-comanda";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** "12 min", "1h", "1h20". */
export function waited(fromIso: string, now: Date): string {
  const m = Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

/** Ordem do trabalho (r66 #3): o que espera pagamento primeiro; "Agendadas de hoje" entra depois de Em atendimento (slot `agendadas`). */
const SECTIONS: { key: keyof CaixaQueue; title: string; slot?: "agendadas" }[] = [
  { key: "aReceber", title: "A receber" },
  { key: "emAtendimento", title: "Em atendimento", slot: "agendadas" },
  { key: "pagasHoje", title: "Pagas hoje" },
];

/**
 * A fila do Caixa (Plano 3): "A receber" (todos os serviços finalizados, a que espera há mais tempo primeiro), "Em atendimento" e
 * "Pagas hoje". Cada linha é uma comanda: número, cliente, serviços com quem fez e quanto falta.
 */
export function CaixaQueueList({ queue, selectedId, onPick, now, today, canCancel, agendadas }: { agendadas?: ReactNode; queue: CaixaQueue; selectedId: string | null; onPick: (id: string) => void; now: Date; today?: string; canCancel?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {SECTIONS.map(({ key, title, slot }) => {
        const rows = queue[key];
        return (
          <Fragment key={key}>
            <section aria-label={title} className="rounded-[var(--radius-card)] border border-line bg-paper">
              <h2 className={cn("flex items-center justify-between px-4 py-3 text-sm font-semibold", rows.length > 0 && "border-b border-line")}>{title}
                {rows.length > 0
                  ? <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", key === "aReceber" ? "bg-gold-soft text-gold-ink" : "bg-paper-2 text-muted")}>{rows.length}</span>
                  : <span className="text-xs font-normal text-muted">Nenhuma</span>}
              </h2>
              {rows.length > 0 && (
                <ul className="divide-y divide-line/70">
                  {rows.map((r) => <Row key={r.id} r={r} kind={key} selected={r.id === selectedId} onPick={onPick} now={now} today={today} canCancel={canCancel && key !== "pagasHoje"} />)}
                </ul>
              )}
            </section>
            {slot === "agendadas" && agendadas}
          </Fragment>
        );
      })}
    </div>
  );
}

function Row({ r, kind, selected, onPick, now, today, canCancel }: { canCancel?: boolean; r: QueueRow; kind: keyof CaixaQueue; selected: boolean; onPick: (id: string) => void; now: Date; today?: string }) {
  const services = r.services.map((s) => [s.label, s.professionalName].filter(Boolean).join(" · ")).join(", ");
  const meta = kind === "pagasHoje" ? `${r.closedAt ? HORA.format(new Date(r.closedAt)) : ""}${r.closedByName ? ` · ${r.closedByName}` : ""}`
    : kind === "aReceber" ? `pronta há ${waited(r.since, now)}` : `aberta às ${HORA.format(new Date(r.since))}`;
  const [cancelOpen, setCancelOpen] = useState(false);
  return (
    <li className="relative">
      <button type="button" aria-label={`Comanda ${r.number} · ${r.clientName}`} aria-current={selected || undefined} onClick={() => onPick(r.id)}
        className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-2/70", selected && "bg-paper-2 shadow-[inset_3px_0_0_var(--color-gold)]")}>
        <span className="w-8 shrink-0 pt-0.5 text-sm font-semibold tabular text-graphite">{r.number}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{r.clientName}</span>
          {services && <span className="block truncate text-xs text-muted">{services}</span>}
          <span className="block text-xs text-muted">{meta}{today && r.day !== today ? ` · de ${DM.format(new Date(`${r.day}T12:00:00Z`))}` : ""}</span>
        </span>
        <span className="shrink-0 text-right">
          {/* Contagem cega (QA r58, I-1): sem o valor das pagas para quem não é gestão. */}
          {r.totalCents != null && <span className="block font-medium tabular">{money(r.totalCents)}</span>}
          {kind !== "pagasHoje" && (r.paidCents ?? 0) > 0 && (r.remainingCents ?? 0) > 0 && <span className="block text-xs font-medium text-alert">{`falta ${money(r.remainingCents!)}`}</span>}
        </span>
      </button>
      {/* Cancelar é raro (psico r68 #2): um "⋯" discreto por cartão, nunca o link vermelho repetido. */}
      {canCancel && (
        <>
          <Menu label={`Mais ações: ${r.clientName}, nº ${r.number}`} className="absolute bottom-2 right-3" trigger={<span aria-hidden className="text-lg leading-none text-graphite">⋯</span>}
            triggerClassName="h-8 min-w-8" items={[{ label: "Cancelar comanda", danger: true, onSelect: () => setCancelOpen(true) }]} />
          <CancelComandaDialog open={cancelOpen} comandaId={r.id} label={`Comanda ${r.number} · ${r.clientName}`} onClose={() => setCancelOpen(false)} />
        </>
      )}
    </li>
  );
}
