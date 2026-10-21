import { parseWithDates } from "@/lib/json-dates";
import { scopesOf, SCOPE_OF, type LiveEventLike } from "@/lib/live-scope";
import type { ConversationResult, NextWaitingResult } from "@/server/queries/conversation";

/**
 * As conversas que o navegador já buscou (GET /api/conversa/[id], fora da fila das Server Actions).
 * Abrir uma conversa mostra NA HORA a última resposta guardada e atualiza por trás; passar o mouse (ou focar) num item da Fila
 * e as primeiras conversas da lista já vêm buscadas antes do clique. Aviso do tempo real de um lead (`deal:<id>`) marca a dele como velha.
 * Tudo some ao sair (`forgetConversations`): o próximo usuário do aparelho não vê conversas do anterior.
 */
export type ConversationOk = Extract<ConversationResult, { ok: true }>;
type Entry = { value: ConversationOk | null; at: number; stale: boolean; gen: number; /** gen da resposta guardada: uma resposta mais velha nunca cobre uma mais nova. */ wrote: number; inflight: Flight | null };
type Flight = { promise: Promise<ConversationResult>; ctrl: AbortController; waiters: number; keep: boolean };

const ERROR = "Não foi possível abrir a conversa. Tente de novo.";
/** Resposta mais nova que isso e sem aviso depois: abrir não busca de novo (o hover que acabou de buscar não dobra o pedido). */
export const FRESH_MS = 15_000;
/** Quantas conversas ficam guardadas (as mais antigas saem primeiro). */
const MAX_ENTRIES = 40;
/** Pré-busca: no máximo 2 ao mesmo tempo e uma fila curta (o servidor nunca recebe uma rajada). */
const PREFETCH_CONCURRENCY = 2;
const PREFETCH_QUEUE = 8;

const entries = new Map<string, Entry>();
const queue: string[] = [];
let prefetching = 0;
let clock = () => Date.now();
let fetcher: typeof fetch = (...args) => fetch(...args);

/** Só testes: relógio e fetch falsos. */
export function __setConversationCacheDeps(deps: { now?: () => number; fetch?: typeof fetch }) {
  if (deps.now) clock = deps.now;
  if (deps.fetch) fetcher = deps.fetch;
}

function entry(id: string): Entry {
  let e = entries.get(id);
  if (!e) {
    e = { value: null, at: 0, stale: true, gen: 0, wrote: -1, inflight: null };
    entries.set(id, e);
    if (entries.size > MAX_ENTRIES) {
      for (const [k, v] of entries) { if (entries.size <= MAX_ENTRIES) break; if (!v.inflight) entries.delete(k); }
    }
  } else { entries.delete(id); entries.set(id, e); } // usada agora: vai para o fim (LRU)
  return e;
}

/** A última conversa guardada deste lead (pode estar velha: quem abre mostra e atualiza por trás). */
export function peekConversation(id: string): ConversationOk | null { return entries.get(id)?.value ?? null; }

/** Guardada há pouco e sem aviso depois: dá para mostrar sem buscar de novo. */
export function isFresh(id: string): boolean {
  const e = entries.get(id);
  return !!e?.value && !e.stale && clock() - e.at < FRESH_MS;
}

/**
 * `priority`: a conversa que a pessoa abriu vai na frente ("high"); a pré-busca e as fotos esperam ("low"). Com ~120 KB/s até o servidor,
 * a pré-busca das primeiras da Fila disputava a banda com a conversa aberta (medido em 17/10). Abrir uma conversa cuja pré-busca já está a
 * caminho (o hover logo antes do clique) aproveita esse pedido, que segue com prioridade baixa: recomeçar perderia o que já chegou.
 */
async function request(id: string, signal: AbortSignal, priority: RequestPriority): Promise<ConversationResult> {
  let res: Response;
  try { res = await fetcher(`/api/conversa/${id}`, { signal, priority, cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" } }); } catch (e) {
    if (signal.aborted) throw e;
    return { ok: false, error: ERROR };
  }
  try { return parseWithDates<ConversationResult>(await res.text()); } catch (e) {
    if (signal.aborted) throw e;
    return { ok: false, error: ERROR };
  }
}

function start(id: string, keep: boolean): Flight {
  const e = entry(id);
  const gen = e.gen;
  const ctrl = new AbortController();
  const flight: Flight = { ctrl, waiters: 0, keep, promise: null as unknown as Promise<ConversationResult> };
  flight.promise = request(id, ctrl.signal, keep ? "low" : "high").then((r) => {
    const cur = entries.get(id);
    if (cur && r.ok && gen >= cur.wrote) {
      // Chegou aviso enquanto buscava (gen mudou): guarda, mas continua velha (a próxima abertura busca de novo).
      cur.value = r; cur.at = clock(); cur.wrote = gen; cur.stale = cur.gen !== gen;
    }
    return r;
  }).finally(() => { const cur = entries.get(id); if (cur?.inflight === flight) cur.inflight = null; });
  e.inflight = flight;
  return flight;
}

/**
 * Busca a conversa (junta com a busca que já está a caminho, a da pré-busca inclusive). `fresh`: depois de uma mudança (envio, nota, ação),
 * sempre um pedido novo — a busca antiga pode ter saído antes da mudança. `signal` (o painel que saiu): cancela o pedido se ninguém mais espera por ele.
 */
export function loadConversation(id: string, opts: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<ConversationResult> {
  const e = entry(id);
  if (opts.fresh) e.gen++;
  // Uma busca cancelada (o painel anterior saiu) nunca é reaproveitada.
  const flight = !opts.fresh && e.inflight && !e.inflight.ctrl.signal.aborted ? e.inflight : start(id, false);
  flight.waiters++;
  const { signal } = opts;
  if (!signal) return flight.promise;
  if (signal.aborted) { release(flight, id); return Promise.reject(new DOMException("Aborted", "AbortError")); }
  return new Promise<ConversationResult>((resolve, reject) => {
    const onAbort = () => { release(flight, id); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", onAbort, { once: true });
    flight.promise.then((r) => { signal.removeEventListener("abort", onAbort); resolve(r); }, (err) => { signal.removeEventListener("abort", onAbort); reject(err); });
  });
}

function release(flight: Flight, id: string) {
  flight.waiters--;
  if (flight.waiters > 0 || flight.keep) return;
  flight.ctrl.abort();
  const e = entries.get(id);
  if (e?.inflight === flight) e.inflight = null; // quem abrir de novo agora começa um pedido novo
}

/** Pré-busca (hover, foco, as primeiras da lista): só se não estiver guardada e nova; no máximo 2 ao mesmo tempo, fila curta. */
export function prefetchConversation(id: string) {
  if (isFresh(id) || entries.get(id)?.inflight) return;
  const at = queue.indexOf(id);
  if (at !== -1) queue.splice(at, 1);
  queue.unshift(id); // o mais recente (o mouse de agora) vai primeiro
  if (queue.length > PREFETCH_QUEUE) queue.length = PREFETCH_QUEUE;
  pump();
}

function pump() {
  while (prefetching < PREFETCH_CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    if (isFresh(id) || entries.get(id)?.inflight) continue;
    prefetching++;
    // Pré-busca não é cancelada quando um painel sai: o que ela trouxer fica guardado.
    start(id, true).promise.catch(() => {}).finally(() => { prefetching--; pump(); });
  }
}

/** A conversa mudou (aviso do tempo real, envio): a guardada continua aparecendo, mas a próxima abertura busca de novo. */
export function invalidateConversation(id: string) {
  const e = entries.get(id);
  if (e) { e.stale = true; e.gen++; }
}
export function invalidateAllConversations() { for (const e of entries.values()) { e.stale = true; e.gen++; } }

/** Aviso do tempo real → quais conversas guardadas ficaram velhas. Tipo desconhecido (ou "reconectado"): todas. */
export function invalidateFromEvent(ev: LiveEventLike) {
  if (!(ev.type in SCOPE_OF) && !ev.scope) { invalidateAllConversations(); return; }
  for (const s of scopesOf(ev)) if (s.startsWith("deal:")) invalidateConversation(s.slice(5));
}

/** Ao sair: esquece tudo (e cancela o que estava a caminho). */
export function forgetConversations() {
  for (const e of entries.values()) e.inflight?.ctrl.abort();
  entries.clear();
  queue.length = 0;
}

/** O "lido" da conversa aberta, por POST leve (fora da fila das Server Actions). `keepalive`: sai mesmo se a pessoa já trocou de tela. */
export function markConversationRead(id: string) {
  void fetcher(`/api/conversa/${id}/lida`, { method: "POST", keepalive: true, credentials: "same-origin" }).catch(() => {});
}

/** "Próximo da fila" depois de enviar, por GET. */
export async function fetchNextWaiting(id: string): Promise<NextWaitingResult> {
  try {
    const r = await fetcher(`/api/conversa/${id}/proximo`, { cache: "no-store", credentials: "same-origin" });
    return (await r.json()) as NextWaitingResult;
  } catch { return { ok: false, error: "Não foi possível buscar o próximo da fila." }; }
}
