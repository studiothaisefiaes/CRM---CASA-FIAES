"use client";
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { QueueItem, QueueSection } from "@/server/queries/queue";
import { isUuid } from "@/lib/uuid";
import { readQueueState, rememberLead } from "./use-queue-state";
import { markUrlAhead, whenRefreshIdle } from "@/components/shell/refresh-gate";

export const DESKTOP = "(min-width: 1024px)";

/**
 * Os itens da Fila que o navegador já conhece, por id. O painel da conversa abre na hora com o item (nome, foto, espera, última mensagem)
 * em vez de esperar o servidor. A lista alimenta o mapa a cada atualização; clique e "Próximo da fila" só leem.
 */
const known = new Map<string, QueueItem>();
export const rememberItem = (item: QueueItem) => { known.set(item.dealId, item); };
/** Esquece os itens (ao sair: o próximo usuário do aparelho não pode ver nome e mensagem de leads do anterior). */
export const forgetKnownItems = () => { known.clear(); };
export const knownItem = (id: string | null | undefined): QueueItem | null => (id ? known.get(id) ?? null : null);
/** Chamado pela lista a cada atualização, antes da pintura (assim o painel nunca vê um id que a lista já tinha). */
export function usePrimeItems(sections: QueueSection[]) {
  useLayoutEffect(() => { for (const s of sections) for (const i of s.items) known.set(i.dealId, i); }, [sections]);
}

/**
 * Troca de conversa no desktop ainda não escrita na URL. A tela troca na hora (este valor), e o `?lead=` só é escrito quando nenhum
 * refresh do tempo real está a caminho (refresh-gate: trocar a URL no meio de um refresh fazia o Next recarregar a página inteira).
 * `from` é o `?lead=` que a URL ainda mostra; se a URL mudar por outro motivo (link do sino, voltar), vale a URL e isto é esquecido.
 */
type PendingLead = { id: string | null; from: string | null; query: string };
let pending: PendingLead | null = null;
/**
 * Os `?lead=` que esta sequência de trocas já escreveu na URL (QA r58). O `useSearchParams` do Next anda atrás do `replaceState`: numa troca
 * rápida (J → B) a URL já está em J quando B é pedido, e depois o Next ainda mostra J por um instante. Esses valores são nossos, não
 * "a URL mudou por outro motivo": antes a troca para B era abandonada, a tela voltava para J, o `?lead=` ficava em J e B nunca era marcada lida.
 */
let written = new Set<string | null>();
const pendingListeners = new Set<() => void>();
const setPending = (p: PendingLead | null) => { pending = p; if (!p) written = new Set(); pendingListeners.forEach((l) => l()); };
const subscribePending = (l: () => void) => { pendingListeners.add(l); return () => { pendingListeners.delete(l); }; };
const urlLead = () => { const l = new URLSearchParams(window.location.search).get("lead"); return isUuid(l) ? l : null; };

/** Escreve na URL a troca pendente (quando não há refresh a caminho). A URL mudou por outro motivo enquanto esperava: desiste. */
function syncPendingUrl() {
  const p = pending;
  if (!p) return;
  const now = urlLead();
  if (window.location.pathname !== "/atendimento" || (now !== p.from && !written.has(now))) { setPending(null); return; }
  written.add(p.id);
  window.history.replaceState(null, "", withLead(p.query, p.id));
  markUrlAhead();
}

/**
 * O lead aberto agora. Em /atendimento vem do `?lead=` da URL (que a Fila troca sem recarregar a página, ver `useOpenLead`),
 * ou da troca que acabou de acontecer e ainda espera para ir para a URL; em /atendimento/[id] é o id da rota, que o servidor já passou.
 */
export function useCurrentLead(routeLead: string | null): string | null {
  const pathname = usePathname();
  const sp = useSearchParams();
  const p = useSyncExternalStore(subscribePending, () => pending, () => null);
  const l = sp.get("lead");
  const fromUrl = isUuid(l) ? l : null;
  // A URL alcançou a troca (ou mudou por outro motivo): esquece a pendente. Alcançou uma escrita nossa do meio do caminho: segue esperando.
  useEffect(() => {
    if (!p) return;
    if (fromUrl === p.id) setPending(null);
    else if (fromUrl !== p.from) setPending(written.has(fromUrl) ? { ...p, from: fromUrl } : null);
  }, [p, fromUrl]);
  if (pathname !== "/atendimento") return routeLead;
  return p && (fromUrl === p.from || written.has(fromUrl)) ? p.id : fromUrl;
}

const withLead = (search: string, id: string | null) => {
  const qs = new URLSearchParams(search);
  if (id) qs.set("lead", id); else qs.delete("lead");
  return qs.size ? `/atendimento?${qs}` : "/atendimento";
};

/**
 * O Quadro (/funil?lead=ID) abre o mesmo painel da Fila numa gaveta (Plano 5): abrir e fechar ficam no Quadro, com os filtros dele.
 * `id` null = fecha (tira o `lead`).
 */
export const boardHref = (search: string, id: string | null) => {
  const qs = new URLSearchParams(search);
  if (id) qs.set("lead", id); else qs.delete("lead");
  return qs.size ? `/funil?${qs}` : "/funil";
};

/** Desktop em /atendimento: troca a conversa na tela já e escreve o `?lead=` quando der (sem refresh a caminho). */
function switchLead(id: string | null, query: string) {
  setPending({ id, from: pending ? pending.from : urlLead(), query });
  whenRefreshIdle(syncPendingUrl);
}

/**
 * Abre um lead pelo painel: no desktop troca a conversa na hora e o `?lead=` com `history.replaceState` (a página não é recarregada e o Next
 * atualiza `useSearchParams`), sem cruzar com um refresh a caminho; fora de /atendimento (a rota /atendimento/ID) é uma navegação normal;
 * no celular vai para a conversa em tela cheia. No Quadro (/funil), troca o `?lead=` do próprio Quadro. `query` são os filtros da Fila (sem `lead`); sem ele vale a URL de agora.
 */
export function useOpenLead() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((id: string, opts: { query?: string } = {}) => {
    rememberLead(id);
    if (pathname === "/funil") { router.replace(boardHref(window.location.search, id), { scroll: false }); return; }
    if (!window.matchMedia(DESKTOP).matches) { router.replace(`/atendimento/${id}`); return; }
    if (pathname === "/atendimento") { switchLead(id, opts.query ?? window.location.search); return; }
    router.replace(withLead(opts.query ?? readQueueState().query, id), { scroll: false });
  }, [router, pathname]);
}

/** Fecha o lead aberto (desktop): volta à Fila com os mesmos filtros e o painel pedindo para escolher uma conversa. No Quadro, fecha a gaveta. */
export function useCloseLead() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    rememberLead(null);
    if (pathname === "/funil") router.push(boardHref(window.location.search, null), { scroll: false });
    else if (pathname === "/atendimento") switchLead(null, window.location.search);
    else router.push(withLead(readQueueState().query, null), { scroll: false });
  }, [router, pathname]);
}

/** Leva a outra tela quando a janela é (ou passa a ser) de celular ou de desktop: /atendimento?lead=ID ↔ /atendimento/ID. */
export function ViewportRedirect({ to, when }: { to: string; when: "desktop" | "mobile" }): null {
  const router = useRouter();
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const go = () => { if (mq.matches === (when === "desktop")) router.replace(to, { scroll: false }); };
    go();
    mq.addEventListener("change", go);
    return () => mq.removeEventListener("change", go);
  }, [to, when, router]);
  return null;
}

