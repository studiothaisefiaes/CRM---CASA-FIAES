/**
 * Tempo real por long-polling, para quando o SSE fica preso no caminho (túnel/proxy que segura stream).
 * Cada pedido espera no servidor até chegar um aviso (ou ~25 s) e termina; por isso nenhum proxy consegue segurá-lo.
 * O primeiro pedido (`after = null`) só pega o cursor; `catchUp` avisa "reconectado" depois dele (avisos de antes podem ter se perdido).
 */
export type PollEvent = { type: string; [k: string]: unknown };
export type PollResult = { status: number; cursor?: number; events?: PollEvent[] };

export function startLongPoll(opts: {
  fetch: (after: number | null, signal: AbortSignal) => Promise<PollResult>;
  onEvent: (e: PollEvent) => void;
  retryMs: number;
  catchUp?: boolean;
}) {
  const ac = new AbortController();
  let cursor: number | null = null;
  const sleep = (ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); ac.signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
  void (async () => {
    while (!ac.signal.aborted) {
      let r: PollResult;
      try { r = await opts.fetch(cursor, ac.signal); } catch { if (!ac.signal.aborted) await sleep(opts.retryMs); continue; }
      if (ac.signal.aborted) return;
      if (r.status === 401) return;
      if (r.status !== 200 || typeof r.cursor !== "number") { await sleep(opts.retryMs); continue; }
      const first = cursor === null;
      cursor = r.cursor;
      if (first && opts.catchUp) opts.onEvent({ type: "reconectado" });
      for (const e of r.events ?? []) opts.onEvent(e);
    }
  })();
  return { stop: () => ac.abort() };
}
