"use client";
import { useState, type ReactNode } from "react";
import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/cn";

/** Painel grande (doc 16/10, 4.0): no computador 70% da largura vindo da direita; no celular, a tela cheia. */
export const PAINEL_GRANDE = "max-w-none sm:w-[min(100%,980px)] lg:w-[70%] lg:rounded-l-[var(--radius-panel)]";

/**
 * Bloco do Hoje (doc 16/10, 4.1): rótulo, número, uma linha de contexto e uma prévia curta (2–3 itens). "Ver todos" (e o "+N" dos que
 * ficaram de fora) abre o painel grande com a lista inteira e as ações. Com zero, o bloco fica no lugar, apagado e pequeno.
 * A região se chama pelo título (é o que os testes e os leitores de tela procuram).
 */
export function HojeBlock({ id, title, icon, count, context, alert, hidden = 0, panel, panelTitle, panelPhrase, panelFooter, className, children }: {
  id: string; title: string; icon: ReactNode; count?: number | null; context?: ReactNode; alert?: boolean;
  /** Quantos itens ficaram fora da prévia ("+N"). */ hidden?: number;
  panel?: ReactNode; panelTitle?: string; panelPhrase?: string; panelFooter?: ReactNode; className?: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const empty = count === 0;
  const hId = `h-${id}`;
  return (
    <section aria-labelledby={hId} data-vazio={empty ? "sim" : "nao"}
      className={cn("flex min-w-0 flex-col rounded-[var(--radius-panel)] border", empty ? "border-line/70 bg-paper-2/60" : alert ? "border-alert/40 bg-paper" : "border-line bg-paper", className)}>
      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 id={hId} className={cn("flex items-center gap-2 text-[15px] font-semibold", empty ? "text-graphite" : "text-ink")}>
            <span aria-hidden className={empty ? "text-muted" : "text-gold"}>{icon}</span>{title}
          </h2>
          {context && <p className={cn("mt-0.5 text-sm", alert ? "font-medium text-alert" : "text-graphite")}>{context}</p>}
        </div>
        {count != null && <span className={cn("font-display leading-none font-light tabular", empty ? "text-[26px] text-muted" : "text-[34px]", alert && "text-alert")}>{count}</span>}
      </header>
      <div className="min-w-0 flex-1 pt-2">{children}</div>
      {panel && (
        <div className="border-t border-line/70 px-2 py-1.5">
          <button type="button" onClick={() => setOpen(true)} aria-label={`Ver todos: ${title}`}
            className="flex min-h-11 w-full items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium text-gold-ink hover:bg-paper-2 lg:min-h-9">
            {hidden > 0 && <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs font-semibold text-graphite tabular">+{hidden}</span>}
            <span className="ml-auto">Ver todos</span>
          </button>
        </div>
      )}
      {panel && (
        <Sheet open={open} onClose={() => setOpen(false)} title={panelTitle ?? title} footer={panelFooter} className={PAINEL_GRANDE}>
          {panelPhrase && <p className="mb-3 text-sm text-graphite">{panelPhrase}</p>}
          {panel}
        </Sheet>
      )}
    </section>
  );
}
