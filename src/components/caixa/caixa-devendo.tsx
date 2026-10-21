"use client";
import { useState, useTransition } from "react";
import { openWalkInAction } from "@/app/(app)/caixa/actions";
import { Button } from "@/components/ui/button";
import type { Debtor } from "@/server/domain/caixa/debts";
import { money } from "@/lib/format";

const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** "Devendo": clientes com dívida aberta. "Receber" abre uma comanda da cliente já com a dívida mais antiga somada (a quitação de sempre). */
export function DevendoList({ rows, onOpened }: { rows: Debtor[]; onOpened: (comandaId: string) => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const receive = (d: Debtor) => start(async () => {
    setError(null);
    const r = await openWalkInAction({ requestKey: crypto.randomUUID(), contactId: d.contactId, item: { kind: "divida", settlesComandaId: d.comandaId } });
    if (!r.ok) { setError(r.error); return; }
    onOpened(r.data!.comandaId);
  });
  return (
    <section aria-label="Devendo" className="rounded-[var(--radius-card)] border border-line bg-paper">
      <h2 className="flex items-center justify-between border-b border-line px-4 py-3 text-sm font-semibold">Devendo
        <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs tabular text-muted">{rows.length}</span>
      </h2>
      {error && <p role="alert" className="px-4 py-2 text-sm text-alert">{error}</p>}
      {rows.length ? (
        <ul className="divide-y divide-line/70">
          {rows.map((d) => (
            <li key={d.contactId} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.name}</span>
                <span className="block text-xs text-muted">{`desde ${dmy(d.sinceDay)}${d.debts > 1 ? ` · ${d.debts} comandas` : ""}`}</span>
              </span>
              <span className="shrink-0 font-medium tabular text-alert">{money(d.totalCents)}</span>
              <Button size="sm" variant="secondary" disabled={pending} aria-label={`Receber de ${d.name}`} onClick={() => receive(d)}>Receber</Button>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-5 text-center text-sm text-muted">Ninguém devendo.</p>}
    </section>
  );
}
