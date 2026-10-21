"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { TeamCashRow } from "@/server/queries/caixa";
import { DRAWER_METHODS, PAY_LABEL } from "@/lib/comanda-math";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CashCloseSheet } from "./cash-close-sheet";
import { ReopenCashButton } from "./reopen-cash-button";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** A tabela de Caixas da equipe: a gestão vê o que entrou em cada caixa, fecha o de quem esqueceu e reabre um fechado. */
export function TeamCash({ rows, viewerId, hasOptions, canGerir }: { rows: TeamCashRow[]; viewerId: string; hasOptions: boolean; canGerir: boolean }) {
  const [closing, setClosing] = useState<TeamCashRow | null>(null);
  const closed = rows.filter((r) => r.status === "fechado").map((r) => ({ id: r.id, ownerName: r.personName, label: `${DM.format(new Date(`${r.day}T12:00:00Z`))} · ${r.personName}` }));
  return (
    <div className="flex flex-col gap-3">
    {canGerir && closed.length > 0 && <div className="flex justify-end"><ReopenCashButton choices={closed} /></div>}
    <section aria-label="Caixas" className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-paper">
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="text-left text-muted">
          <th className="px-4 py-2 font-medium">Pessoa</th><th className="font-medium">Abriu</th><th className="font-medium">Fundo</th><th className="font-medium">Recebido</th>
          <th className="font-medium">Dinheiro esperado</th><th className="font-medium">Diferença</th><th className="font-medium">Situação</th><th />
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const got = DRAWER_METHODS.filter((m) => r.received[m] > 0);
            return (
              <tr key={r.id} className="border-t border-line/70 align-top">
                <td className="px-4 py-3 font-medium">{r.personName}</td>
                <td className="py-3 tabular">{HORA.format(new Date(r.openedAt))}<span className="block text-xs text-muted">{DM.format(new Date(`${r.day}T12:00:00Z`))}</span></td>
                <td className="py-3 tabular">{money(r.openingCents)}</td>
                <td className="py-3">{got.length ? got.map((m) => <span key={m} className="block tabular">{`${PAY_LABEL[m]} ${money(r.received[m])}`}</span>) : <span className="text-muted">—</span>}
                  {r.received.cortesia > 0 && <span className="block text-xs text-muted">{`Cortesia ${money(r.received.cortesia)}`}</span>}</td>
                <td className="py-3 tabular">{money(r.expectedCash)}</td>
                <td className={cn("py-3 tabular", r.differences.length ? "font-semibold text-alert" : "")}>{r.differenceCents == null ? "—"
                  : r.differences.length ? r.differences.map((d) => <span key={d.method} className="block">{`${PAY_LABEL[d.method]} ${money(d.cents)}`}</span>) : money(0)}</td>
                <td className="py-3">{r.status === "aberto" ? <span className="rounded-full bg-gold-soft px-2 py-0.5 text-xs font-medium text-gold-ink">Aberto</span>
                  : <span className="text-xs text-graphite">{`Fechado${r.closedAt ? ` às ${HORA.format(new Date(r.closedAt))}` : ""}${r.closedByName && r.closedByName !== r.personName ? ` por ${r.closedByName}` : ""}`}{r.approvedByName && <span className="block text-muted">{`Diferença aprovada por ${r.approvedByName}`}</span>}</span>}</td>
                <td className="py-3 pr-4 text-right">
                  {canGerir && r.status === "aberto" && r.personId !== viewerId && <Button size="sm" variant="secondary" onClick={() => setClosing(r)}>{`Fechar o caixa de ${r.personName}`}</Button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {closing && <CashCloseSheet open onClose={() => setClosing(null)} ownerName={closing.personName} sessionId={closing.id} blind={false} canGerir hasOptions={hasOptions}
        summary={{ expected: closing.expected, byBrand: closing.byBrand, openComandas: closing.openComandas }} />}
    </section>
    </div>
  );
}
