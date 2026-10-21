"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { coalesce, shouldRefresh } from "@/lib/live-scope";
import { startLongPoll } from "@/lib/live-poll";
import { playAlert } from "./sound";
import { setRefreshing, takeUrlAhead } from "./refresh-gate";
import { checkVersion } from "./version-state";

export { shouldRefresh };

export type LiveEvent = { type: string; dealId?: string; scope?: string | string[]; [k: string]: unknown };
type Listener = (e: LiveEvent) => void;
type Api = { subscribe: (l: Listener) => () => void; requestRefresh: (opts?: { minGapMs?: number }) => void };

const REFRESH_DEBOUNCE_MS = 150;
const REFRESH_MAX_WAIT_MS = 2000; // fluxo contínuo de avisos não adia o refresh para sempre
const FOCUS_MIN_GAP_MS = 5000; // voltar para a aba/janela não recarrega se acabou de recarregar
const SSE_WAIT_MS = 3000; // sem o primeiro aviso nesse prazo, o stream está preso no caminho (proxy/túnel): vai de long-polling
const POLL_MODE_KEY = "crm-live-mode"; // a aba lembra: depois da primeira vez já começa no long-polling
const VERSION_FRESH_MS = 60_000; // a versão conferida há menos disso vale para o próximo refresh (21/10: 5 s custava uma ida ao servidor a cada mensagem)
const VERSION_RETRY_MS = 5000; // servidor fora do ar (troca de versão): espera e confere de novo
const VERSION_RETRIES = 6;
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
 * e ao voltar para a aba/janela (visibilitychange e focus), no máximo uma vez a cada 5 s (telas que não assinam a Fila, como os Relatórios).
 */
export function useLiveRefresh(scopes: string[], opts: { pollMs?: number } = {}) {
  const api = useContext(Ctx);
  const { requestRefresh } = api;
  useLive(scopes, () => requestRefresh());
  const { pollMs } = opts;
  useEffect(() => {
    if (!pollMs) return;
    const tick = () => { if (document.visibilityState === "visible") requestRefresh({ minGapMs: FOCUS_MIN_GAP_MS }); };
    const id = setInterval(tick, pollMs);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); window.removeEventListener("focus", tick); };
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
  const lastAt = useRef(0);
  // O refresh vai numa transição: `refreshing` fica ligado até a Fila nova aparecer (refresh-gate: a troca de conversa espera para mexer na URL).
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => { if (!refreshing) setRefreshing(false); }, [refreshing]);

  useEffect(() => {
    let stopped = false;
    let failures = 0;
    let recheck: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (document.visibilityState !== "visible") { stale.current = true; return; }
      // Versão nova do CRM (20/10): o refresh respondido pelo servidor novo recarrega a página inteira na mão da pessoa (o Next faz isso
      // quando o build muda), e com o servidor reiniciando ele cai na página de erro do navegador. Antes, confere a versão: nova, não
      // recarrega (o aviso "Versão nova do CRM. Atualizar" aparece); servidor fora do ar, tenta de novo em 5 s (até 30 s, depois segue).
      const v = await checkVersion({ maxAgeMs: VERSION_FRESH_MS });
      if (stopped) return;
      if (v === "nova") return;
      if (v === "falhou" && failures < VERSION_RETRIES) { failures++; clearTimeout(recheck); recheck = setTimeout(() => refresh.current?.(), VERSION_RETRY_MS); return; }
      failures = 0;
      stale.current = false;
      lastAt.current = Date.now();
      setRefreshing(true); // já agora (o `refreshing` do React só liga no próximo render)
      // Depois de uma troca de conversa (replaceState), o refresh vai como navegação para a URL de agora (ver refresh-gate).
      const ahead = takeUrlAhead();
      startRefresh(() => { if (ahead) router.replace(window.location.pathname + window.location.search + window.location.hash, { scroll: false }); else router.refresh(); });
    };
    const call = coalesce(run, REFRESH_DEBOUNCE_MS, REFRESH_MAX_WAIT_MS);
    refresh.current = call;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let poll: { stop: () => void } | null = null;
    let dropped = false;
    const dispatch = (ev: LiveEvent) => listeners.current.forEach((l) => l(ev));
    // Som em toda mensagem de cliente (conversa nova ou não, em qualquer etapa); ligação atendida e envios da Casa não tocam.
    // Só com `aviso` (o servidor já tirou mensagem velha, reação e canal quieto); o playAlert limita a um bipe a cada 3 s.
    const deliver = (ev: LiveEvent) => { dispatch(ev); if ((ev.type === "lead_criado" || ev.type === "mensagem_recebida" || ev.type === "alerta") && ev.aviso === true) playAlert(); };
    // Long-polling: mesmo tempo real, por pedidos que terminam (nenhum proxy segura). `catchUp` = avisos de antes podem ter se perdido.
    const startPoll = (catchUp: boolean) => {
      try { sessionStorage.setItem(POLL_MODE_KEY, "poll"); } catch {}
      poll = startLongPoll({
        fetch: async (after, signal) => {
          const r = await fetch(`/api/stream/poll${after === null ? "" : `?after=${after}`}`, { cache: "no-store", signal });
          return r.ok ? { status: 200, ...(await r.json()) } : { status: r.status };
        },
        onEvent: (ev) => deliver(ev as LiveEvent), retryMs: 3000, catchUp,
      });
    };
    const connect = () => {
      es = new EventSource("/api/stream");
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { es?.close(); clearTimeout(retry); if (!stopped) startPoll(true); }, SSE_WAIT_MS);
      es.onmessage = (m) => {
        clearTimeout(watchdog);
        let ev: LiveEvent; try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "conectado") {
          // Voltou depois de cair: avisos podem ter se perdido; tipo desconhecido = todos os escopos.
          if (dropped) { dropped = false; dispatch({ type: "reconectado" }); }
          return;
        }
        deliver(ev);
      };
      es.onerror = () => { clearTimeout(watchdog); dropped = true; es?.close(); if (!stopped) retry = setTimeout(connect, 3000); };
    };
    let pollMode = false;
    try { pollMode = sessionStorage.getItem(POLL_MODE_KEY) === "poll"; } catch {}
    if (pollMode) startPoll(false); else connect();
    // Aba que estava oculta e perdeu avisos volta a mostrar o dado novo.
    const onVisible = () => { if (document.visibilityState === "visible" && stale.current) call(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; es?.close(); clearTimeout(retry); clearTimeout(watchdog); clearTimeout(recheck); poll?.stop(); call.cancel(); refresh.current = null; document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);

  const subscribe = useCallback((l: Listener) => { listeners.current.add(l); return () => { listeners.current.delete(l); }; }, []);
  const requestRefresh = useCallback((opts?: { minGapMs?: number }) => {
    if (opts?.minGapMs && Date.now() - lastAt.current < opts.minGapMs) return;
    refresh.current?.();
  }, []);
  const value = useMemo(() => ({ subscribe, requestRefresh }), [subscribe, requestRefresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
