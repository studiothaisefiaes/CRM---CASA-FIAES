import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Os 4 filtros que a recepção usa todo dia; o resto mora em "Mais filtros" (r66, problema 1). */
export const FILTROS_VISIVEIS = ["sumidas", "na_hora", "com_horario", "aniversario_semana"] as const;
export type FilterLink = { key: string; label: string; count?: number; href: string; on: boolean; help?: string };

export const CHIP = "inline-flex h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3.5 text-sm font-medium transition-colors sm:h-10";

function Chip({ f }: { f: FilterLink }) {
  return (
    <Link href={f.href} aria-current={f.on ? "true" : undefined} title={f.help} className={cn(CHIP, "shrink-0 snap-start", f.on ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-paper-2")}>
      {f.label}{f.count != null && <span className={cn("tabular text-xs", f.on ? "text-paper/80" : "text-muted")}>{f.count.toLocaleString("pt-BR")}</span>}
    </Link>
  );
}

/**
 * Filtros da lista de Clientes: 4 chips à vista e "Mais filtros" com o resto (outros chips, "Só clientes", seleções e Aplicar em `children`).
 * Um filtro ativo que está lá dentro sobe para a vista e a gaveta abre, para ninguém ficar sem ver o que está filtrando.
 */
export function ContactsFilterBar({ filters, toggles, clearHref, hasActive, children }: { filters: FilterLink[]; toggles: FilterLink[]; clearHref: string; hasActive: boolean; children: ReactNode }) {
  const vis = filters.filter((f) => (FILTROS_VISIVEIS as readonly string[]).includes(f.key) || f.on);
  const rest = filters.filter((f) => !vis.includes(f));
  const anyToggle = toggles.some((t) => t.on);
  return (
    <div className="mb-4">
      {/* Celular (r68 #21): os chips rolam só dentro desta faixa, com o fim esmaecido mostrando que tem mais; a página não rola para o lado. */}
      <nav aria-label="Filtros" className="-mx-5 mb-2 flex snap-x gap-2 overflow-x-auto scroll-px-5 px-5 pb-1 pr-10 scroll-thin [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 sm:pr-0 sm:[mask-image:none]">
        {vis.map((f) => <Chip key={f.key} f={f} />)}
      </nav>
      <details open={hasActive || anyToggle}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-gold-ink sm:min-h-9">Mais filtros</summary>
        <div className="mt-2 flex flex-col gap-3">
          {rest.length > 0 && <div className="flex flex-wrap gap-2">{rest.map((f) => <Chip key={f.key} f={f} />)}</div>}
          {toggles.length > 0 && <div className="flex flex-wrap gap-2">{toggles.map((t) => <Chip key={t.key} f={t} />)}</div>}
          {children}
          {hasActive && <Link href={clearHref} className="inline-flex min-h-11 items-center text-sm font-medium text-gold-ink underline underline-offset-4 sm:min-h-10">Limpar filtros</Link>}
        </div>
      </details>
    </div>
  );
}
