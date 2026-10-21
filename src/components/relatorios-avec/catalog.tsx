import Link from "next/link";
import type { AvecCatalog, AvecReportLite, AvecType } from "@/lib/avec-catalog";
import { Badge } from "@/components/ui/badge";
import { IconArrowRight } from "@/components/icons";
import { periodLabel } from "./format";

type Report = AvecReportLite & { fileName: string; importedByName: string | null };
const lines = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "linha" : "linhas"}`;
const Applied = () => <Badge tone="ok">Virou dado no CRM</Badge>;

/** Relatórios do Avec: cartões dos principais, assuntos recolhidos, vazios no fim. */
export function AvecCatalogView({ catalog }: { catalog: AvecCatalog<Report> }) {
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="avec-principais">
        <h2 id="avec-principais" className="mb-3 text-xs font-semibold text-muted">Principais</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.principais.map(({ title, type }) => (
            <li key={title} data-card="">
              {type ? (
                <Link href={`/relatorios/avec/${type.latest.id}`} className="flex h-full min-h-24 flex-col gap-1.5 rounded-[var(--radius-card)] border border-line bg-paper p-4 hover:bg-paper-2">
                  <span className="font-medium text-ink">{title}</span>
                  <span className="text-sm text-graphite tabular">{periodLabel(type.latest.dateFrom, type.latest.dateTo)} · {lines(type.latest.rowCount)}</span>
                  {type.applied && <span><Applied /></span>}
                </Link>
              ) : (
                <div className="flex h-full min-h-24 flex-col gap-1.5 rounded-[var(--radius-card)] border border-dashed border-line-strong p-4">
                  <span className="font-medium text-graphite">{title}</span>
                  <span className="text-sm text-muted">Ainda não enviado. Exporte do Avec e envie aqui.</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      {catalog.secoes.map((s) => (
        <details key={s.key} className="group rounded-[var(--radius-card)] border border-line bg-paper">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 [&::-webkit-details-marker]:hidden">
            <span className="font-medium">{s.label}</span>
            <span className="text-sm text-muted">{s.types.length} {s.types.length === 1 ? "tipo" : "tipos"} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span></span>
          </summary>
          <TypeList types={s.types} />
        </details>
      ))}
      {catalog.vazios.length > 0 && (
        <details className="group rounded-[var(--radius-card)] border border-line bg-paper-2/60">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-graphite [&::-webkit-details-marker]:hidden">
            <span>Vazios ({catalog.vazios.length})</span><span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <TypeList types={catalog.vazios} />
        </details>
      )}
    </div>
  );
}

function TypeList({ types }: { types: AvecType<Report>[] }) {
  return (
    <ul className="divide-y divide-line border-t border-line">
      {types.map((t) => (
        <li key={t.title} className="px-4 py-3">
          <Link href={`/relatorios/avec/${t.latest.id}`} className="flex min-h-11 items-center gap-4 hover:text-gold-ink">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.title}</span>{t.applied && <Applied />}</span>
              <span className="block truncate text-sm text-muted">{periodLabel(t.latest.dateFrom, t.latest.dateTo)} · {t.latest.fileName}</span>
            </span>
            <span className="shrink-0 text-sm text-graphite tabular">{lines(t.latest.rowCount)}</span>
            <IconArrowRight size={14} className="shrink-0 text-muted" />
          </Link>
          {t.also.length > 0 && <p className="text-sm text-muted">Mesmas linhas e período: {t.also.map((a, i) => <span key={a.id}>{i > 0 && ", "}<Link href={`/relatorios/avec/${a.id}`} className="underline underline-offset-2">{a.title}</Link></span>)}</p>}
          {t.items.length > 1 && (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-gold-ink">Envios anteriores ({t.items.length - 1})</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {t.items.slice(1).map((r) => <li key={r.id}><Link href={`/relatorios/avec/${r.id}`} className="underline underline-offset-2">{periodLabel(r.dateFrom, r.dateTo)}</Link> · {lines(r.rowCount)}</li>)}
              </ul>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
