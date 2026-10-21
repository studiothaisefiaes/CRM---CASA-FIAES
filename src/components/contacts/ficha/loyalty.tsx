"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { faltamParaPremio, LOYALTY_REASON_LABEL, loyaltyLine } from "@/lib/loyalty";
import type { LoyaltyView } from "@/server/queries/loyalty-view";

const LINK = "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink lg:min-h-0";
const when = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });

/**
 * O botão "Abrir" do cartão Fidelidade (Resumo da ficha): abre um painel com todos os programas e o histórico de pontos.
 * Só consulta: usar o prêmio é na comanda.
 */
export function LoyaltyOpener({ view }: { view: LoyaltyView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={LINK} aria-label="Abrir Fidelidade" onClick={() => setOpen(true)}>Abrir</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Fidelidade">
        <div className="flex flex-col gap-6">
          <ul className="flex flex-col gap-3" aria-label="Programas">
            {view.programs.map((p) => (
              <li key={p.programId} className="flex flex-col gap-1 rounded-[var(--radius-control)] border border-line px-4 py-3">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-base font-semibold text-ink">{p.name}</span>
                  {p.ready && <Badge tone="ok">Prêmio disponível</Badge>}
                </span>
                <span className="tabular text-sm text-ink">{loyaltyLine(p)}</span>
                {p.kind === "contagem" && !p.ready && p.goal != null && <span className="text-sm text-graphite">{faltamParaPremio(Math.max(1, p.goal - p.balance))}</span>}
                {p.kind === "aniversario" && !p.ready && <span className="text-sm text-graphite">O prêmio é no mês do aniversário, uma vez por ano.</span>}
              </li>
            ))}
            {view.programs.length === 0 && <li className="text-sm text-graphite">Nenhum programa de fidelidade em uso.</li>}
          </ul>
          <section aria-labelledby="fid-hist">
            <h3 id="fid-hist" className="text-base font-semibold text-ink">Histórico de pontos</h3>
            {view.history.length === 0 ? <p className="mt-1 text-sm text-graphite">Nenhum ponto ainda.</p> : (
              <ul className="mt-2 divide-y divide-line/70 rounded-[var(--radius-control)] border border-line">
                {view.history.map((h) => (
                  <li key={h.id} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">{LOYALTY_REASON_LABEL[h.reason]} · {h.programName}</span>
                      <span className="block text-xs text-muted">{when(h.at)}{h.note ? ` · ${h.note}` : ""}</span>
                    </span>
                    <span className="tabular shrink-0 text-sm font-semibold text-ink">{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </Sheet>
    </>
  );
}
