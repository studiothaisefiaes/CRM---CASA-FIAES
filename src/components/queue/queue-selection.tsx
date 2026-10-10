"use client";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/toast";
import { BULK_MAX } from "@/lib/bulk-limits";
import { cn } from "@/lib/cn";

/**
 * Seleção em massa da Fila. Mora num contexto porque o botão "Selecionar" fica no topo (cabeçalho da Fila), a lista marca os itens
 * e a barra de ações fica embaixo. `mode` liga a seleção: tocar num item passa a marcar em vez de abrir a conversa.
 */
export type QueueSelectionState = {
  mode: boolean; selected: ReadonlySet<string>;
  /** Liga a seleção (opcionalmente já marcando um item). */
  enter: (id?: string) => void;
  exit: () => void;
  /** Marca/desmarca. Com `range`, marca tudo entre o último tocado e este, na ordem visível (`order`). */
  toggle: (id: string, opts?: { range?: boolean; order?: string[] }) => void;
  clear: () => void;
};
const Ctx = createContext<QueueSelectionState | null>(null);
export const useQueueSelection = () => useContext(Ctx);

export function QueueSelectionProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [mode, setMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const last = useRef<string | null>(null);

  const add = useCallback((ids: string[]) => {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const id of ids) { if (next.size >= BULK_MAX && !next.has(id)) { toast(`No máximo ${BULK_MAX} de cada vez`, "info"); break; } next.add(id); }
      return next;
    });
  }, [toast]);
  const toggle = useCallback<QueueSelectionState["toggle"]>((id, opts) => {
    const from = last.current;
    last.current = id;
    if (opts?.range && from && opts.order) {
      const a = opts.order.indexOf(from), b = opts.order.indexOf(id);
      if (a >= 0 && b >= 0) { add(opts.order.slice(Math.min(a, b), Math.max(a, b) + 1)); return; }
    }
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size >= BULK_MAX) { toast(`No máximo ${BULK_MAX} de cada vez`, "info"); return cur; }
      else next.add(id);
      return next;
    });
  }, [add, toast]);
  const enter = useCallback((id?: string) => { setMode(true); if (id) { last.current = id; add([id]); } }, [add]);
  const clear = useCallback(() => { setSelected(new Set()); last.current = null; }, []);
  const exit = useCallback(() => { setMode(false); clear(); }, [clear]);
  const value = useMemo(() => ({ mode, selected, enter, exit, toggle, clear }), [mode, selected, enter, exit, toggle, clear]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** "Selecionar" no topo da Fila (celular e desktop): liga a seleção em massa; "Cancelar" desliga e limpa. */
export function SelectToggle({ className }: { className?: string }) {
  const sel = useQueueSelection();
  if (!sel) return null;
  return (
    <button type="button" aria-pressed={sel.mode} onClick={() => (sel.mode ? sel.exit() : sel.enter())}
      className={cn("inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium text-graphite transition-colors hover:bg-paper-2 hover:text-ink lg:min-h-8", sel.mode && "bg-ink text-paper hover:bg-ink hover:text-paper", className)}>
      {sel.mode ? "Cancelar" : "Selecionar"}
    </button>
  );
}

/** No celular, com a seleção ligada, esconde o que não ajuda a marcar (resumo, busca, visões) para sobrar tela para a lista. */
export function HideWhileSelecting({ children, className }: { children: ReactNode; className?: string }) {
  const sel = useQueueSelection();
  return <div className={cn(className, sel?.mode && "max-lg:hidden")}>{children}</div>;
}
