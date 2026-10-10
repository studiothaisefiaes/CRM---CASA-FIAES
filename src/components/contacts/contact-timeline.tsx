"use client";
import { useMemo, useState } from "react";
import type { TimelineDay, TimelineEntry } from "@/lib/contact-timeline";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { HISTORY_EVENT_LIMIT } from "@/lib/history";
import { cn } from "@/lib/cn";

type Filter = "tudo" | "conversa" | "atendimento";
const PAGE = 40;
const DOT: Record<TimelineEntry["tone"], string> = { default: "bg-line-strong", etapa: "bg-gold", alerta: "bg-alert", ok: "bg-ok" };

function Entry({ e }: { e: TimelineEntry }) {
  const msg = e.kind === "mensagem";
  return (
    <li className="relative flex gap-3 py-2.5 pl-6">
      <span aria-hidden className={cn("absolute left-0 top-[1.05rem] size-2.5 rounded-full ring-4 ring-paper", msg ? (e.direction === "in" ? "bg-ink" : "bg-gold") : DOT[e.tone])} />
      <div className="min-w-0 flex-1">
        <p className={cn("break-words text-base leading-snug", msg ? "text-ink" : "text-graphite")}>
          {msg && <span className="sr-only">{e.direction === "in" ? "Cliente: " : "Casa: "}</span>}{e.text}
        </p>
        <p className="mt-0.5 text-xs text-muted">{e.meta}</p>
      </div>
    </li>
  );
}

/**
 * A história inteira do contato, do mais novo ao mais antigo, em dias de Salvador. Mostra os primeiros 40 itens e o resto sob "Ver mais".
 * O filtro separa a conversa (mensagens) do atendimento (etapas, vendas, tarefas e mudanças). O texto já vem pronto do servidor.
 */
export function ContactTimeline({ days, messageTotal, messageShown, eventsTruncated = false }: { days: TimelineDay[]; messageTotal: number; messageShown: number; eventsTruncated?: boolean }) {
  const [filter, setFilter] = useState<Filter>("tudo");
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(() => {
    const keep = (e: TimelineEntry) => filter === "tudo" || (filter === "conversa" ? e.kind === "mensagem" : e.kind !== "mensagem");
    return days.map((d) => ({ ...d, entries: d.entries.filter(keep) })).filter((d) => d.entries.length);
  }, [days, filter]);
  const total = filtered.reduce((n, d) => n + d.entries.length, 0);

  // Os primeiros `shown` itens, contando entre os dias (um dia pode ser cortado no meio).
  const visible = filtered.reduce<{ acc: typeof filtered; left: number }>((st, d) => {
    if (st.left <= 0) return st;
    const entries = d.entries.slice(0, st.left);
    return { acc: [...st.acc, { ...d, entries }], left: st.left - entries.length };
  }, { acc: [], left: shown }).acc;

  return (
    <section aria-labelledby="historico" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="historico" className="font-serif text-2xl font-light tracking-[-0.01em]">Histórico</h2>
        <Segmented<Filter> label="Filtrar o histórico" value={filter} onChange={(v) => { setFilter(v); setShown(PAGE); }} className="flex-nowrap gap-1"
          options={[{ value: "tudo", label: "Tudo" }, { value: "conversa", label: "Conversa" }, { value: "atendimento", label: "Atendimento" }]} />
      </div>
      {total === 0 ? (
        <p className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-paper-2/40 px-4 py-8 text-center text-sm text-graphite">Nada por aqui ainda.</p>
      ) : (
        <div className="space-y-5" data-testid="historico">
          {visible.map((d) => (
            <div key={d.key}>
              <h3 className="sticky top-0 z-[1] -mx-1 bg-paper/95 px-1 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-gold-ink backdrop-blur first-letter:uppercase">{d.label}</h3>
              <ol className="relative ml-1 border-l border-line">
                {d.entries.map((e) => <Entry key={e.id} e={e} />)}
              </ol>
            </div>
          ))}
        </div>
      )}
      {total > shown && (
        <Button variant="secondary" className="mt-4 w-full pointer-coarse:min-h-11 sm:w-auto" onClick={() => setShown((n) => n + PAGE)}>
          Ver mais <span className="font-normal text-muted">({total - shown} {total - shown === 1 ? "item" : "itens"})</span>
        </Button>
      )}
      {eventsTruncated && <p className="mt-3 text-xs text-muted" data-testid="aviso-eventos">Mostrando os {HISTORY_EVENT_LIMIT} eventos mais recentes. Os mais antigos continuam guardados.</p>}
      {messageTotal > messageShown && <p className="mt-3 text-xs text-muted">Mostrando as últimas {messageShown} de {messageTotal.toLocaleString("pt-BR")} mensagens. As mais antigas continuam guardadas.</p>}
    </section>
  );
}
