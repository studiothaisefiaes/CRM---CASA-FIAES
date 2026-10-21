"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type UIEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { QueueItem, QueueSection } from "@/server/queries/queue";
import type { QueueSectionKey } from "@/lib/queue";
import { Empty } from "@/components/ui/empty";
import { EASE, EASE_IN, LIMITS, T, exitOf } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { QueueRow } from "./queue-item";

import type { QueueSelectionState } from "./queue-selection";

export { __itemRenderCount } from "./queue-item";

/**
 * As linhas. Até `LIMITS.presenceItems` itens: entram por opacidade; saem por opacidade e a altura fecha por FLIP
 * (`popLayout` tira a que sai do fluxo e as de baixo deslizam por `transform`, sem animar height). Acima do teto: lista comum, sem motion.
 * `layoutDependency` = posição: só quem mudou de lugar é medido (o relógio e o resto da tela nunca disparam medição).
 * Com "reduzir movimento" o MotionConfig global desliga o deslize; fica só a opacidade.
 */
function Rows({ items, children }: { items: QueueItem[]; children: (item: QueueItem) => ReactNode }) {
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
 * Conversas abertas neste aparelho e a última mensagem vista nelas (`lastAt`). Ao sair da conversa a bolinha não volta enquanto a lista
 * ainda não atualizou (o servidor marca ao abrir); mensagem mais nova que a vista volta a contar.
 */
const seenHere = new Map<string, number>();
const atOf = (i: QueueItem) => (i.lastAt ? new Date(i.lastAt).getTime() : 0);
export function unreadShown(item: QueueItem, selectedId: string | null | undefined): number {
  if (item.dealId === selectedId) return 0;
  const seen = seenHere.get(item.dealId);
  return seen !== undefined && atOf(item) <= seen ? 0 : item.unread ?? 0;
}

/**
 * A lista da Fila (desenho aprovado): uma lista só, sem cabeçalhos de seção, na ordem do servidor (o que precisa de resposta primeiro: atrasadas no topo).
 * A seção de cada lead continua valendo para o texto de prazo da linha.
 * Um `listbox` com cada lead como `option` (um link). Setas, Home e End movem o foco (roving tabindex); Enter abre.
 * Seleção em massa (`selection`): o listbox é `aria-multiselectable` e a linha continua sendo a `option` (nada de controle dentro dela): Espaço marca,
 * e com a seleção ligada ("Selecionar") tocar marca em vez de abrir, `aria-selected` passa a dizer "marcado" e Esc sai. A caixinha é só desenho.
 * O listbox só tem opções: o estado vazio fica do lado de fora.
 * Só recebe dados e callbacks (nada de next/navigation), para poder ser testada sozinha; `QueueListRoute` liga à rota.
 */
export function QueueList({ sections, selectedId, hrefFor = defaultHref, onOpen, onStageTap, onKindMenu, listRef, onScroll, className, selection, empty, footer }: {
  /** O que dizer quando a lista está vazia (ex.: "só as suas: Mostrar de todas"). */ empty?: React.ReactNode; /** Embaixo da lista (ex.: pessoas fora da lista na busca). */ footer?: React.ReactNode;
  sections: QueueSection[]; selectedId?: string | null; hrefFor?: (item: QueueItem) => string; selection?: QueueSelectionState;
  /** Tocar na etiqueta da etapa de uma conversa (troca de etapa ali mesmo). */ onStageTap?: (item: QueueItem) => void;
  /** Botão direito ou toque longo numa linha: o menu "Marcar como…" no ponto tocado. */ onKindMenu?: (item: QueueItem, at: { x: number; y: number }) => void;
  onOpen?: (item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => void; listRef?: (el: HTMLDivElement | null) => void; onScroll?: (e: UIEvent<HTMLDivElement>) => void; className?: string;
}) {
  const inner = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = sections.flatMap((s) => s.items);
  const sectionOf = new Map<string, QueueSectionKey>(sections.flatMap((s) => s.items.map((i) => [i.dealId, s.key] as const)));
  const visible = items.map((i) => i.dealId);
  // Roving tabindex: o item que recebeu o foco pela última vez (setas ou clique); sem isso, o aberto ou o primeiro.
  const tabId = [activeId, selectedId].find((id) => id && visible.includes(id)) ?? visible[0] ?? null;
  const openAt = selectedId ? items.find((i) => i.dealId === selectedId)?.lastAt ?? null : undefined;
  useEffect(() => {
    if (!selectedId || openAt === undefined) return;
    const at = openAt ? new Date(openAt).getTime() : 0;
    seenHere.set(selectedId, Math.max(seenHere.get(selectedId) ?? 0, at));
  }, [selectedId, openAt]);

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
  const latest = useRef({ selection, visible, onOpen, onStageTap, onKindMenu });
  useEffect(() => { latest.current = { selection, visible, onOpen, onStageTap, onKindMenu }; });
  const openRow = useCallback((item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => latest.current.onOpen?.(item, e), []);
  const stageTap = useCallback((item: QueueItem) => latest.current.onStageTap?.(item), []);
  const kindMenu = useCallback((item: QueueItem, at: { x: number; y: number }) => latest.current.onKindMenu?.(item, at), []);
  const selectRow = useCallback((id: string, range: boolean) => {
    const { selection: sel, visible: order } = latest.current;
    if (!sel) return;
    if (sel.mode) sel.toggle(id, { range, order }); else sel.enter(id);
  }, []);

  const setRefs = useCallback((el: HTMLDivElement | null) => { inner.current = el; listRef?.(el); }, [listRef]);

  if (items.length === 0) return <div className={cn("min-h-0 overflow-y-auto", className)}>{empty ?? <Empty title="Nenhuma conversa por aqui">Quando uma cliente escrever, ela aparece nesta lista na hora.</Empty>}{footer}</div>;

  return (
    <div className={cn("flex flex-col min-h-0", className)}>
      {selection && <span id="fila-ajuda" className="sr-only">Espaço marca várias conversas para agir em massa.</span>}
      <motion.div layoutScroll ref={setRefs} role="listbox" aria-label="Fila" aria-orientation="vertical" aria-multiselectable={selection ? true : undefined} aria-describedby={selection ? "fila-ajuda" : undefined} onKeyDown={onKeyDown} onFocus={onFocus} onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-thin">
        <Rows items={items}>
          {(item) => (
            // A conversa aberta já conta como lida (o servidor marca ao abrir; a próxima atualização da lista confirma).
            <QueueRow item={item} section={sectionOf.get(item.dealId) ?? "aguardando"} selected={item.dealId === selectedId} href={hrefFor(item)} tabIndex={item.dealId === tabId ? 0 : -1} onOpen={onOpen ? openRow : undefined}
              unread={unreadShown(item, selectedId)}
              onStageTap={onStageTap ? stageTap : undefined} onKindMenu={onKindMenu ? kindMenu : undefined} selectable={!!selection} selecting={!!selection?.mode} checked={!!selection?.selected.has(item.dealId)} onSelect={selection ? selectRow : undefined} />
          )}
        </Rows>
        {footer}
      </motion.div>
    </div>
  );
}
