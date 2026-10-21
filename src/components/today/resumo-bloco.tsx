"use client";
import { useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";
import { PAINEL_GRANDE } from "./hoje-block";

/**
 * Bloco do resumo do Hoje (protótipo v3, 17/10): título, número e uma prévia curta, sem nada clicável dentro. O bloco inteiro é um botão
 * (o "Ver todos" esticado por cima) que abre o painel grande com a lista completa e as ações. A região se chama pelo título.
 */
export function ResumoBloco({ id, title, count, countLabel, more = "Ver todos", wide, empty, panelTitle, panelPhrase, panelFooter, panel, children }: {
  id: string; title: string; count?: number | null; /** No lugar do número ("17 clientes"). */ countLabel?: string; more?: string;
  /** Ocupa 2 colunas do tablet em diante ("O dia na Casa"). */ wide?: boolean; /** Sem nada: o bloco fica apagado. */ empty?: boolean;
  panelTitle?: string; panelPhrase?: string; panelFooter?: ReactNode; panel: ReactNode; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hId = `h-${id}`;
  return (
    <section aria-labelledby={hId} data-vazio={empty ? "sim" : "nao"}
      className={cn("group relative flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-panel)] border px-4 pb-3 pt-3.5 transition-colors lg:px-5",
        empty ? "border-line/70 bg-paper-2/60" : "border-line bg-paper hover:border-line-strong", wide && "sm:col-span-2")}>
      <header className="flex items-baseline justify-between gap-3">
        <h2 id={hId} className={cn("text-[15px] font-semibold", empty ? "text-graphite" : "text-ink")}>{title}</h2>
        {(countLabel ?? count) != null && <span className="shrink-0 text-[15px] font-medium tabular text-graphite">{countLabel ?? count}</span>}
      </header>
      <div className="pointer-events-none min-w-0">{children}</div>
      <button type="button" onClick={() => setOpen(true)} aria-label={`${more}: ${title}`}
        className="mt-auto inline-flex min-h-11 items-center self-start text-sm font-semibold text-gold-ink lg:min-h-8 after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-gold group-hover:underline underline-offset-4">
        {more}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={panelTitle ?? title} footer={panelFooter} className={PAINEL_GRANDE}>
        {panelPhrase && <p className="mb-3 text-sm text-graphite">{panelPhrase}</p>}
        {panel}
      </Sheet>
    </section>
  );
}

/** Uma linha da prévia: o que é à esquerda, o quando/quanto à direita, em cinza. Sem reticências: o texto quebra. */
export function PreviewRow({ left, right, className }: { left: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div data-testid="previa-linha" className={cn("flex items-baseline justify-between gap-3 border-t border-line/70 py-1.5 text-[13.5px] first:border-t-0", className)}>
      <span className="min-w-0 break-words">{left}</span>
      {right != null && <span className="shrink-0 text-right text-muted tabular">{right}</span>}
    </div>
  );
}
