"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Estado da Fila que sobrevive a abrir uma conversa e voltar: filtros (a query da URL, sem `lead`), a rolagem da lista e o último lead aberto.
 * Fica em sessionStorage (`cf-queue`) e é espelhado na URL (view, filtro, q…). Tudo em try/catch: janela privada ou site data bloqueado não quebram a tela.
 */
export const QUEUE_STORAGE_KEY = "cf-queue";
export type QueueSaved = { query: string; scrollTop: number; lead: string | null };
const EMPTY: QueueSaved = { query: "", scrollTop: 0, lead: null };

export function readQueueState(): QueueSaved {
  try {
    const raw = sessionStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<QueueSaved>;
    return { query: typeof v.query === "string" ? v.query : "", scrollTop: Number.isFinite(v.scrollTop) ? Number(v.scrollTop) : 0, lead: typeof v.lead === "string" ? v.lead : null };
  } catch { return EMPTY; }
}

export function writeQueueState(patch: Partial<QueueSaved>) {
  try { sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ ...readQueueState(), ...patch })); } catch { /* sem armazenamento: a Fila só não lembra */ }
}

/** Marca (ou esquece) o último lead aberto na Fila. */
export const rememberLead = (id: string | null) => writeQueueState({ lead: id });

const scrollTo = (node: HTMLElement, top: number) => { node.scrollTop = top; };

const subscribers = new Set<() => void>();
const subscribe = (cb: () => void) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; };
const notify = () => subscribers.forEach((f) => f());

/** A query salva da Fila (sem `lead`); vazia no servidor e antes de haver o que lembrar. Use para montar o "Voltar para a fila". */
export function useSavedQueueQuery(): string {
  return useSyncExternalStore(subscribe, () => readQueueState().query, () => "");
}

/**
 * Lembra a query atual da Fila e a rolagem da lista; devolve `ref` (callback) + `onScroll` para o contêiner rolável.
 * Ao montar, se a query for a mesma da última vez, devolve a lista à posição salva; se mudou (outro filtro), começa do topo.
 */
export function useQueueState(query: string) {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const saved = readQueueState();
    if (saved.query === query) {
      // Mesma visão da última vez, inclusive a padrão (query vazia): devolve a rolagem.
      if (el && saved.scrollTop > 0) scrollTo(el, saved.scrollTop);
    } else if (query) {
      writeQueueState({ query, scrollTop: 0 });
      if (el) scrollTo(el, 0);
    }
    // query vazia com outra salva: o QueueRestore leva ao filtro salvo, então aqui não apaga nada.
    notify();
  }, [query, el]);
  // Ao sair da tela o navegador mexe na rolagem da lista que está sendo trocada (scroll que não é do usuário). `freeze()` guarda a posição
  // do momento do clique e ignora o resto; a lista nova nasce com o hook zerado.
  const frozen = useRef(false);
  const onScroll = useCallback((e: { currentTarget: { scrollTop: number } }) => {
    if (!frozen.current) writeQueueState({ scrollTop: Math.round(e.currentTarget.scrollTop) });
  }, []);
  const thaw = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Se a navegação não desmontar a lista (clique cancelado, rota que falhou), a rolagem volta a ser salva depois de alguns segundos.
  const freeze = useCallback(() => { frozen.current = true; clearTimeout(thaw.current); thaw.current = setTimeout(() => { frozen.current = false; }, 5000); }, []);
  useEffect(() => () => clearTimeout(thaw.current), []);
  return { ref, onScroll, freeze };
}
