"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { QueueItem, QueueSection } from "@/server/queries/queue";
import { SECTION_LABEL, type QueueSectionKey } from "@/lib/queue";
import { Empty } from "@/components/ui/empty";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { QueueRow } from "./queue-item";

const HEAD: Record<QueueSectionKey, string> = {
  atrasados: "bg-alert text-white py-2.5 font-serif text-[18px]",
  perto: "bg-gold-soft text-gold-ink py-2 text-sm font-semibold",
  aguardando: "bg-paper text-ink py-2 text-sm font-semibold border-b border-line",
  "acoes-hoje": "bg-paper-2 text-graphite py-1.5 text-xs font-semibold",
  parados: "bg-paper-2 text-graphite py-1.5 text-xs font-semibold",
  "aguardando-cliente": "bg-paper-2 text-graphite py-1.5 text-xs font-semibold",
};

export const defaultHref = (i: QueueItem) => `/atendimento/${i.dealId}`;

/**
 * A lista da Fila: um `listbox` com as seções em `group` e cada lead como `option` (um link). Setas, Home e End movem o foco; Enter abre.
 * Só recebe dados e callbacks (nada de next/navigation), para poder ser testada sozinha; `QueueListRoute` liga à rota.
 */
export function QueueList({ sections, selectedId, hrefFor = defaultHref, onOpen, listRef, onScroll, className }: {
  sections: QueueSection[]; selectedId?: string | null; hrefFor?: (item: QueueItem) => string;
  onOpen?: (item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => void; listRef?: (el: HTMLDivElement | null) => void; onScroll?: (e: UIEvent<HTMLDivElement>) => void; className?: string;
}) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const firstId = sections.find((s) => s.key !== "aguardando-cliente" || expanded || sections.length === 1)?.items[0]?.dealId ?? null;
  const tabId = selectedId && sections.some((s) => s.items.some((i) => i.dealId === selectedId)) ? selectedId : firstId;

  // Lead aberto por link de fora (sino, push): traz o item para a área visível.
  useEffect(() => {
    if (!selectedId) return;
    inner.current?.querySelector<HTMLElement>(`[data-deal-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const opts = [...(inner.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    if (!opts.length) return;
    e.preventDefault();
    const at = opts.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? opts.length - 1 : e.key === "ArrowDown" ? Math.min(opts.length - 1, at + 1) : Math.max(0, at <= 0 ? 0 : at - 1);
    opts[next].focus();
    opts[next].scrollIntoView({ block: "nearest" });
  };

  const setRefs = useCallback((el: HTMLDivElement | null) => { inner.current = el; listRef?.(el); }, [listRef]);

  return (
    <div ref={setRefs} role="listbox" aria-label="Fila" aria-orientation="vertical" onKeyDown={onKeyDown} onScroll={onScroll}
      className={cn("overflow-y-auto overscroll-contain scroll-thin min-h-0", className)}>
      {total === 0 && <Empty title="Nenhuma conversa por aqui">Quando uma cliente escrever, ela aparece nesta lista na hora.</Empty>}
      {sections.map((s) => {
        const collapsible = s.key === "aguardando-cliente" && sections.length > 1;
        const open = !collapsible || expanded || s.items.some((i) => i.dealId === selectedId);
        const headId = `fila-${s.key}`;
        return (
          <div key={s.key} role="group" aria-labelledby={headId}>
            <div className={cn("sticky top-0 z-[1] flex items-center justify-between gap-3 px-4", HEAD[s.key])}>
              <span id={headId} role="presentation">{SECTION_LABEL[s.key]}</span>
              <span className="flex items-center gap-2">
                <span className="tabular opacity-90">{s.items.length}</span>
                {collapsible && (
                  <button type="button" aria-expanded={open} onClick={() => setExpanded((v) => !v)} className="min-h-8 pointer-coarse:min-h-11 px-2 -mr-2 rounded-[var(--radius-control)] hover:bg-ink/5 font-medium">
                    {open ? "Recolher" : "Mostrar"}
                  </button>
                )}
              </span>
            </div>
            <AnimatePresence initial={false}>
              {open && s.items.map((item) => (
                <motion.div key={item.dealId} role="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: EASE }}>
                  <QueueRow item={item} section={s.key} selected={item.dealId === selectedId} href={hrefFor(item)} tabIndex={item.dealId === tabId ? 0 : -1} onOpen={onOpen} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}
