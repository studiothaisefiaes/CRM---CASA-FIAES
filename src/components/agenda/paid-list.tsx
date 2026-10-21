"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PaidRow } from "@/server/domain/caixa/paid";
import { PAID_CHIPS, type PaidChip } from "@/lib/paid-chips";
import { canBookIn, useAgendaSheets } from "./agenda-sheets";

// Os filtros moram fora deste módulo de cliente: a página (servidor) usa PAID_CHIPS e paidFilterOf, e valores de um módulo
// "use client" chegam ao servidor só como referência (PAID_CHIPS.some quebrava a aba).
export { PAID_CHIPS, paidFilterOf, type PaidChip } from "@/lib/paid-chips";

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dm = (day: string) => DM.format(new Date(`${day}T12:00:00Z`));
const NEXT = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

/**
 * Agenda › "Já pagaram" (7.9): quem pagou e ainda não usou. O que mais importa é "Sem horário marcado" (pagou e não voltou): o botão
 * Agendar abre o Marcar já com a cliente. Valores só para quem tem `valores.ver` (a lista chega sem eles do servidor).
 */
export function PaidList({ rows, chip, chipHref, withValues, today }: {
  rows: PaidRow[]; chip: PaidChip | null; chipHref: Record<"todos" | PaidChip, string>; withValues: boolean; today: string; nowMs: number;
}) {
  const { catalog, book } = useAgendaSheets();
  const canBook = canBookIn(catalog);
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Filtrar quem já pagou" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scroll-thin lg:mx-0 lg:px-0">
        {[{ value: null, label: "Todos" }, ...PAID_CHIPS].map((c) => (
          <Link key={c.label} href={chipHref[c.value ?? "todos"]} aria-current={chip === c.value ? "page" : undefined}
            className={cn("inline-flex h-11 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium sm:h-9", chip === c.value ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>{c.label}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <div className="rounded-[var(--radius-panel)] border border-line bg-paper"><Empty title="Ninguém por aqui">Quem pagou e ainda não usou (pacote, crédito ou serviço pago antes) aparece nesta lista.</Empty></div>
      ) : (
        <ul className="divide-y divide-line/70 rounded-[var(--radius-panel)] border border-line bg-paper">
          {rows.map((r) => (
            <li key={r.contactId} aria-label={r.name} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-5 sm:px-5">
              <div className="min-w-0 flex-1">
                <Link href={`/contatos/${r.contactId}`} className="font-medium hover:text-gold-ink">{r.name}</Link>
                <ul className="mt-1 flex flex-col gap-1">
                  {r.entries.map((e, k) => (
                    <li key={k} className="text-sm">
                      <span className={e.kind === "credito_avec" ? "text-gold-ink" : undefined}>{e.label}</span>
                      {(e.valueCents != null || e.paidOn) && (
                        <span className="block text-xs text-muted">{[withValues && e.valueCents != null ? money(e.valueCents) : null, e.paidOn ? `pago em ${dm(e.paidOn)}` : null].filter(Boolean).join(" · ")}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                {r.nextAppointmentAt
                  ? <span className="text-sm text-graphite">{`Próximo horário: ${NEXT.format(new Date(r.nextAppointmentAt)).replace(".", "")}`}</span>
                  : <span className="rounded-full bg-alert-soft px-2 py-0.5 text-xs font-semibold text-alert">Sem horário marcado</span>}
                {!r.nextAppointmentAt && canBook && (
                  <Button size="sm" variant="secondary" onClick={() => book({ day: today, time: "", client: { contactId: r.contactId, name: r.name } })}>Agendar</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
