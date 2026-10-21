"use client";
import { useState } from "react";
import Link from "next/link";
import type { DealDetail } from "@/server/queries/deal";
import { formatBRL } from "@/lib/money";
import { appointmentLine, packageLine } from "@/lib/client-avec";
import { bahiaDay, displayName, returnLine } from "@/lib/client-rhythm";
import { contactHref } from "@/lib/lead-href";
import { cn } from "@/lib/cn";
import { useClock } from "@/components/pipeline/timer";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { month: "short", year: "numeric", timeZone: "America/Bahia" }).replace(". de ", "/").replace(" de ", "/").replace(".", "");
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

/**
 * Quem é a cliente, numa linha no topo da conversa (abaixo de 1280 px). A linha usa a frase curta da situação (a mesma da ficha);
 * tocar abre o resto: a frase inteira, última visita, retorno, preferida, quanto gastou (só com "ver valores") e "Ver ficha completa".
 */
export function ContextStrip({ d, className }: { d: DealDetail; className?: string }) {
  const [open, setOpen] = useState(false);
  const c = d.context;
  const retorno = useClock((now) => (c.retorno ? returnLine(c.retorno, bahiaDay(now)) : null));
  const proximo = useClock((now) => (c.nextAppointment ? appointmentLine(c.nextAppointment, now) : null));
  const head = c.short || [c.isFirstContact ? "Primeira conversa com a Casa" : `Fala com a Casa desde ${monthYear(c.firstContactAt)}`, c.visits ? `${c.visits} ${c.visits === 1 ? "visita" : "visitas"}` : null].filter(Boolean).join(" · ");
  return (
    <section aria-label="Quem é a cliente" className={cn("shrink-0 mx-3 mt-2 rounded-[var(--radius-card)] border border-line bg-paper text-sm", className)}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`contexto-${d.deal.id}`}
        className="flex w-full min-h-11 items-center gap-2 px-3 text-left">
        <span className="min-w-0 truncate font-medium text-ink first-letter:uppercase">{head}</span>
        <span className="ml-auto shrink-0 text-xs font-medium text-gold-ink">{open ? "fechar" : "ver mais"}</span>
      </button>
      {open && (
        <div id={`contexto-${d.deal.id}`} className="px-3 pb-3">
          {c.situation && <p className="mb-2 text-sm text-ink first-letter:uppercase">{c.situation}</p>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {proximo && <div className="col-span-2"><dt className="text-muted text-xs">Próximo horário</dt><dd>{proximo}</dd></div>}
            {c.activePackage && <div className="col-span-2"><dt className="text-muted text-xs">Pacote</dt><dd>{packageLine(c.activePackage)}</dd></div>}
            {retorno && <div className="col-span-2"><dt className="text-muted text-xs">Retorno</dt><dd>{retorno}</dd></div>}
            <div><dt className="text-muted text-xs">Última visita</dt><dd>{c.lastVisit ? `${shortDate(c.lastVisit.at)}${c.lastVisit.service ? ` · ${c.lastVisit.service}` : ""}` : "nenhuma registrada"}</dd></div>
            <div><dt className="text-muted text-xs">Profissional preferida</dt><dd>{displayName(c.preferredProfessional) ?? "—"}</dd></div>
            <div><dt className="text-muted text-xs">Atendeu antes</dt><dd>{c.previousOwner ?? "—"}</dd></div>
            {c.totalCents != null && <div><dt className="text-muted text-xs">Já gastou</dt><dd>{c.totalCents > 0 ? formatBRL(c.totalCents) : "Nada registrado"}</dd></div>}
          </dl>
          <Link href={contactHref(d.contact.id)} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline-offset-4 hover:underline">Ver ficha completa</Link>
        </div>
      )}
    </section>
  );
}
