"use client";
import { useCallback, useEffect, useLayoutEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { QueueItem, QueueSection } from "@/server/queries/queue";
import { isUuid } from "@/lib/uuid";
import { readQueueState, rememberLead } from "./use-queue-state";

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
 * O lead aberto agora. Em /atendimento vem do `?lead=` da URL (que a Fila troca sem recarregar a página, ver `useOpenLead`);
 * em /atendimento/[id] é o id da rota, que o servidor já passou.
 */
export function useCurrentLead(routeLead: string | null): string | null {
  const pathname = usePathname();
  const sp = useSearchParams();
  if (pathname !== "/atendimento") return routeLead;
  const l = sp.get("lead");
  return isUuid(l) ? l : null;
}

const withLead = (search: string, id: string | null) => {
  const qs = new URLSearchParams(search);
  if (id) qs.set("lead", id); else qs.delete("lead");
  return qs.size ? `/atendimento?${qs}` : "/atendimento";
};

/**
 * Abre um lead pelo painel: no desktop troca o `?lead=` na hora com `history.replaceState` (a página não é recarregada e o Next atualiza `useSearchParams`);
 * fora de /atendimento (a rota /atendimento/ID) é uma navegação normal; no celular vai para a conversa em tela cheia.
 * `query` são os filtros da Fila (sem `lead`); sem ele vale a URL de agora.
 */
export function useOpenLead() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((id: string, opts: { query?: string } = {}) => {
    rememberLead(id);
    if (!window.matchMedia(DESKTOP).matches) { router.replace(`/atendimento/${id}`); return; }
    if (pathname === "/atendimento") { window.history.replaceState(null, "", withLead(opts.query ?? window.location.search, id)); return; }
    router.replace(withLead(opts.query ?? readQueueState().query, id), { scroll: false });
  }, [router, pathname]);
}

/** Fecha o lead aberto (desktop): volta à Fila com os mesmos filtros e o painel pedindo para escolher uma conversa. */
export function useCloseLead() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(() => {
    rememberLead(null);
    if (pathname === "/atendimento") window.history.replaceState(null, "", withLead(window.location.search, null));
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

