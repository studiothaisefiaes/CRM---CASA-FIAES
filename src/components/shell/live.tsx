"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { coalesce, shouldRefresh } from "@/lib/live-scope";
import { playAlert } from "./sound";

export { shouldRefresh };

export type LiveEvent = { type: string; dealId?: string; scope?: string | string[]; [k: string]: unknown };
type Listener = (e: LiveEvent) => void;
type Api = { subscribe: (l: Listener) => () => void; requestRefresh: () => void };

const REFRESH_DEBOUNCE_MS = 400;
const Ctx = createContext<Api>({ subscribe: () => () => {}, requestRefresh: () => {} });

/**
 * Assina o tempo real.
 * - `useLive()` devolve `{ subscribe }` (todos os avisos, mesmo com a aba oculta; é o que o LateWatch usa).
 * - `useLive(scopes, onEvent)` chama `onEvent` só para os avisos que tocam em `scopes` (ver `shouldRefresh`).
 */
export function useLive(scopes?: string[], onEvent?: (e: LiveEvent) => void) {
  const api = useContext(Ctx);
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; });
  const key = scopes?.join("|") ?? null;
  useEffect(() => {
    if (key === null) return;
    const mine = key ? key.split("|") : [];
    return api.subscribe((e) => { if (shouldRefresh(e, mine)) handler.current?.(e); });
  }, [api, key]);
  return api;
}

/**
 * A tela declara os escopos que mostra e só recarrega (router.refresh) quando um aviso toca neles.
 * Rajadas viram um refresh só; com a aba oculta o refresh espera ela voltar. `pollMs` recarrega de tempos em tempos
 * e ao focar a aba (telas que não assinam a Fila, como os Relatórios).
 */
export function useLiveRefresh(scopes: string[], opts: { pollMs?: number } = {}) {
  const api = useContext(Ctx);
  const { requestRefresh } = api;
  useLive(scopes, () => requestRefresh());
  const { pollMs } = opts;
  useEffect(() => {
    if (!pollMs) return;
    const tick = () => { if (document.visibilityState === "visible") requestRefresh(); };
    const id = setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [pollMs, requestRefresh]);
}

/** Componente para páginas de servidor: `<LiveRefresh scopes={["queue"]} />`. */
export function LiveRefresh({ scopes, pollMs }: { scopes: string[]; pollMs?: number }) {
  useLiveRefresh(scopes, { pollMs });
  return null;
}

/** Mantém uma conexão SSE e reparte os avisos às telas, que decidem pelos escopos se recarregam. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const listeners = useRef(new Set<Listener>());
  const stale = useRef(false);
  const refresh = useRef<ReturnType<typeof coalesce> | null>(null);

  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "visible") { stale.current = true; return; }
      stale.current = false;
      router.refresh();
    };
    const call = coalesce(run, REFRESH_DEBOUNCE_MS);
    refresh.current = call;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let dropped = false;
    const dispatch = (ev: LiveEvent) => listeners.current.forEach((l) => l(ev));
    const connect = () => {
      es = new EventSource("/api/stream");
      es.onmessage = (m) => {
        let ev: LiveEvent; try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "conectado") {
          // Voltou depois de cair: avisos podem ter se perdido; tipo desconhecido = todos os escopos.
          if (dropped) { dropped = false; dispatch({ type: "reconectado" }); }
          return;
        }
        dispatch(ev);
        if (ev.type === "lead_criado") playAlert();
      };
      es.onerror = () => { dropped = true; es?.close(); if (!stopped) retry = setTimeout(connect, 3000); };
    };
    connect();
    // Aba que estava oculta e perdeu avisos volta a mostrar o dado novo.
    const onVisible = () => { if (document.visibilityState === "visible" && stale.current) call(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; es?.close(); clearTimeout(retry); call.cancel(); refresh.current = null; document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);

  const subscribe = useCallback((l: Listener) => { listeners.current.add(l); return () => { listeners.current.delete(l); }; }, []);
  const requestRefresh = useCallback(() => { refresh.current?.(); }, []);
  const value = useMemo(() => ({ subscribe, requestRefresh }), [subscribe, requestRefresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
