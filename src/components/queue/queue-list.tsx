"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { QueueItem, QueueSection } from "@/server/queries/queue";
import { SECTION_LABEL, type QueueSectionKey } from "@/lib/queue";
import { Empty } from "@/components/ui/empty";
import { EASE, EASE_IN, LIMITS, T, exitOf } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { QueueRow } from "./queue-item";

import type { QueueSelectionState } from "./queue-selection";

export { __itemRenderCount } from "./queue-item";

const HEAD: Record<QueueSectionKey, string> = {
  atrasados: "bg-alert text-white py-2.5 font-serif text-[18px]",
  estourado: "bg-gold-soft text-gold-ink py-2 text-sm font-semibold border-b border-gold/40",
  perto: "bg-gold-soft text-gold-ink py-2 text-sm font-semibold",
  aguardando: "bg-paper text-ink py-2 text-sm font-semibold border-b border-line",
  "acoes-hoje": "bg-paper-2 text-graphite py-1.5 text-xs font-semibold",
  parados: "bg-paper-2 text-graphite py-1.5 text-xs font-semibold",
  "aguardando-cliente": "bg-paper-2 text-graphite py-1.5 text-xs font-semibold",
  reengajar: "bg-paper-2 text-graphite py-1.5 text-xs font-semibold",
};

/**
 * As linhas de uma seção. Até `LIMITS.presenceItems` itens: entram por opacidade; saem por opacidade e a altura fecha por FLIP
 * (`popLayout` tira a que sai do fluxo e as de baixo deslizam por `transform`, sem animar height). Acima do teto: lista comum, sem motion.
 * `layoutDependency` = posição: só quem mudou de lugar é medido (o relógio e o resto da tela nunca disparam medição).
 * Com "reduzir movimento" o MotionConfig global desliga o deslize; fica só a opacidade.
 */
function Rows({ items, children }: { items: QueueItem[]; section: QueueSectionKey; children: (item: QueueItem) => React.ReactNode }) {
  if (items.length > LIMITS.presenceItems) return <>{items.map((item) => <div key={item.dealId} role="none">{children(item)}</div>)}</>;
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {items.map((item, i) => (
        <motion.div key={item.dealId} role="none" layout="position" layoutDependency={i} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: T.base, ease: EASE } }}
          exit={{ opacity: 0, transition: { duration: exitOf(T.base), ease: EASE_IN } }} transition={{ layout: { duration: T.base, ease: EASE } }}>
          {children(item)}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

export const defaultHref = (i: QueueItem) => `/atendimento/${i.dealId}`;

/**
 * A lista da Fila: um `listbox` com as seções em `group` e cada lead como `option` (um link). Setas, Home e End movem o foco (roving tabindex); Enter abre.
 * Seleção em massa (`selection`): o listbox é `aria-multiselectable` e a linha continua sendo a `option` (nada de controle dentro dela): Espaço marca,
 * e com a seleção ligada ("Selecionar") tocar marca em vez de abrir, `aria-selected` passa a dizer "marcado" e Esc sai. A caixinha é só desenho.
 * O listbox só tem grupos e opções: o estado vazio e o botão que recolhe "Aguardando a cliente" ficam do lado de fora.
 * Só recebe dados e callbacks (nada de next/navigation), para poder ser testada sozinha; `QueueListRoute` liga à rota.
 */
export function QueueList({ sections, selectedId, hrefFor = defaultHref, onOpen, listRef, onScroll, className, selection }: {
  sections: QueueSection[]; selectedId?: string | null; hrefFor?: (item: QueueItem) => string; selection?: QueueSelectionState;
  onOpen?: (item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => void; listRef?: (el: HTMLDivElement | null) => void; onScroll?: (e: UIEvent<HTMLDivElement>) => void; className?: string;
}) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const collapsible = sections.find((s) => s.key === "aguardando-cliente" && sections.length > 1) ?? null;
  const isOpen = (s: QueueSection) => s !== collapsible || expanded || s.items.some((i) => i.dealId === selectedId);
  const visible = sections.filter(isOpen).flatMap((s) => s.items.map((i) => i.dealId));
  // Roving tabindex: o item que recebeu o foco pela última vez (setas ou clique); sem isso, o aberto ou o primeiro.
  const tabId = [activeId, selectedId].find((id) => id && visible.includes(id)) ?? visible[0] ?? null;

  // Lead aberto por link de fora (sino, push): traz o item para a área visível.
  useEffect(() => {
    if (!selectedId) return;
    inner.current?.querySelector<HTMLElement>(`[data-deal-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const opt = (e.target as HTMLElement).closest<HTMLElement>("[role=option]");
    if (selection && e.key === " " && opt?.dataset.dealId) {
      e.preventDefault(); // Espaço não rola a lista: marca o item (e liga a seleção, se ainda não estava)
      if (!selection.mode) selection.enter(opt.dataset.dealId); else selection.toggle(opt.dataset.dealId, { range: e.shiftKey, order: visible });
      return;
    }
    if (selection?.mode && e.key === "Escape") { e.preventDefault(); selection.exit(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const opts = [...(inner.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    if (!opts.length) return;
    e.preventDefault();
    const at = opts.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? opts.length - 1 : e.key === "ArrowDown" ? Math.min(opts.length - 1, at + 1) : Math.max(0, at <= 0 ? 0 : at - 1);
    opts[next].focus();
    opts[next].scrollIntoView({ block: "nearest" });
  };
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>("[role=option]")?.dataset.dealId;
    if (id) setActiveId(id);
  };

  // Callbacks estáveis para as linhas (memo): leem o valor atual por ref, assim a lista pode re-renderizar sem acordar as 100 linhas.
  const latest = useRef({ selection, visible, onOpen });
  useEffect(() => { latest.current = { selection, visible, onOpen }; });
  const openRow = useCallback((item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => latest.current.onOpen?.(item, e), []);
  const selectRow = useCallback((id: string, range: boolean) => {
    const { selection: sel, visible: order } = latest.current;
    if (!sel) return;
    if (sel.mode) sel.toggle(id, { range, order }); else sel.enter(id);
  }, []);

  const setRefs = useCallback((el: HTMLDivElement | null) => { inner.current = el; listRef?.(el); }, [listRef]);

  if (total === 0) return <div className={cn("min-h-0 overflow-y-auto", className)}><Empty title="Nenhuma conversa por aqui">Quando uma cliente escrever, ela aparece nesta lista na hora.</Empty></div>;

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {selection && <span id="fila-ajuda" className="sr-only">Espaço marca vários leads para agir em massa.</span>}
      <motion.div layoutScroll ref={setRefs} role="listbox" aria-label="Fila" aria-orientation="vertical" aria-multiselectable={selection ? true : undefined} aria-describedby={selection ? "fila-ajuda" : undefined} onKeyDown={onKeyDown} onFocus={onFocus} onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-thin">
        {sections.map((s) => {
          if (!isOpen(s)) return null; // recolhida: só a barra de baixo, fora do listbox
          const headId = `fila-${s.key}`;
          return (
            <div key={s.key} role="group" aria-labelledby={headId} className="relative">
              <div className={cn("sticky top-0 z-[1] flex items-center justify-between gap-3 px-4", HEAD[s.key])}>
                <span id={headId} role="presentation">{SECTION_LABEL[s.key]}</span>
                <span className="tabular opacity-90" role="presentation">{s.items.length}</span>
              </div>
              <Rows items={s.items} section={s.key}>
                {(item) => (
                  <QueueRow item={item} section={s.key} selected={item.dealId === selectedId} href={hrefFor(item)} tabIndex={item.dealId === tabId ? 0 : -1} onOpen={onOpen ? openRow : undefined}
                    selectable={!!selection} selecting={!!selection?.mode} checked={!!selection?.selected.has(item.dealId)} onSelect={selection ? selectRow : undefined} />
                )}
              </Rows>
            </div>
          );
        })}
      </motion.div>
      {collapsible && (
        <button type="button" aria-expanded={isOpen(collapsible)} onClick={() => setExpanded((v) => !v)}
          className="shrink-0 flex items-center justify-between gap-3 px-4 min-h-11 border-t border-line bg-paper-2 text-sm font-medium text-graphite hover:text-ink">
          <span>{SECTION_LABEL["aguardando-cliente"]} <span className="tabular">({collapsible.items.length})</span></span>
          <span>{isOpen(collapsible) ? "Recolher" : "Mostrar"}</span>
        </button>
      )}
    </div>
  );
}
