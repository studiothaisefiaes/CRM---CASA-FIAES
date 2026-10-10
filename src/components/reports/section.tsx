import type { ReactNode } from "react";
import { LEGEND, type LegendKey } from "@/lib/report-legend";

/** Seção editorial: título em Newsreader, fio no topo (sem caixa), "Como é calculado" e CSV do bloco. */
export function Section({ id, title, lead, csv, legend, children, className = "" }: {
  id: string; title: string; lead?: ReactNode; csv?: { href: string; label: string }; legend: LegendKey; children: ReactNode; className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-t`} className={`border-t border-line pt-6 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 mb-4">
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="font-serif text-[22px] lg:text-[28px] leading-tight font-light">{title}</h2>
          {lead && <p className="text-[14px] text-graphite mt-1">{lead}</p>}
        </div>
        {csv && <a href={csv.href} download className="inline-flex items-center min-h-11 text-[13px] text-gold-ink underline underline-offset-2 hover:text-ink" aria-label={`Baixar CSV: ${csv.label}`}>Baixar CSV</a>}
      </header>
      {children}
      <details className="group mt-4">
        <summary className="inline-flex items-center gap-1.5 min-h-11 cursor-pointer list-none text-[13px] text-gold-ink hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>Como é calculado
        </summary>
        <p className="text-[13px] leading-relaxed text-graphite max-w-[68ch] pb-2">{LEGEND[legend]}</p>
      </details>
    </section>
  );
}

export const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted py-2">{children}</p>;
