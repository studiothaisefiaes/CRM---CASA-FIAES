"use client";
import { useState, useTransition } from "react";
import { cancelarAgendadaAction, openComandaAction } from "@/app/(app)/caixa/actions";
import type { AgendadaRow } from "@/server/queries/caixa";
import { CancelInline } from "./cancel-inline";
import { cn } from "@/lib/cn";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

/** "Agendadas de hoje": quem tem horário e ainda não tem comanda. Um clique abre a comanda da visita, com os serviços marcados. */
export function AgendadasList({ rows, onOpened, canCancel }: { rows: AgendadaRow[]; onOpened: (comandaId: string) => void; canCancel?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = (r: AgendadaRow) => start(async () => {
    setError(null); setBusy(r.key);
    const res = await openComandaAction(r.appointmentId);
    setBusy(null);
    if (!res.ok) { setError(res.error); return; }
    onOpened(res.data!.comandaId);
  });
  return (
    <section aria-label="Agendadas de hoje" className="rounded-[var(--radius-card)] border border-line bg-paper">
      <h2 className={cn("flex items-center justify-between px-4 py-3 text-sm font-semibold", rows.length > 0 && "border-b border-line")}>Agendadas de hoje
        {rows.length > 0 ? <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs tabular text-muted">{rows.length}</span> : <span className="text-xs font-normal text-muted">Nenhuma</span>}
      </h2>
      {error && <p role="alert" className="px-4 py-2 text-sm text-alert">{error}</p>}
      {rows.length ? (
        <ul className="divide-y divide-line/70">
          {rows.map((r) => (
            <li key={r.key}>
              <button type="button" aria-label={`Abrir comanda de ${r.clientName}`} disabled={pending} onClick={() => open(r)}
                className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-paper-2/70 disabled:opacity-60", busy === r.key && "bg-paper-2")}>
                <span className="w-12 shrink-0 pt-0.5 text-sm font-semibold tabular text-graphite">{HORA.format(new Date(r.at))}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.clientName}</span>
                  <span className="block truncate text-xs text-muted">{r.services.map((s) => [s.label, s.professionalName].filter(Boolean).join(" · ")).join(", ")}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-xs font-medium text-gold-ink">Abrir comanda</span>
              </button>
              {canCancel && <CancelInline text="Cancelar horário" label={r.clientName} run={(reason) => cancelarAgendadaAction(r.appointmentId, reason)} />}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
