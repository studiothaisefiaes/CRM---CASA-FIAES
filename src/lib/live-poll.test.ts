import { describe, it, expect, vi } from "vitest";
import { startLongPoll, type PollResult } from "./live-poll";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("startLongPoll (tempo real por long-polling)", () => {
  it("primeiro pega o cursor, depois pede só o que vem depois dele e repassa os avisos", async () => {
    const calls: (number | null)[] = [];
    const replies: PollResult[] = [{ status: 200, cursor: 5, events: [] }, { status: 200, cursor: 7, events: [{ type: "mensagem_recebida" }, { type: "lead_criado" }] }];
    const got: string[] = [];
    const lp = startLongPoll({
      fetch: async (after) => { calls.push(after); const r = replies.shift(); if (!r) await new Promise(() => {}); return r!; },
      onEvent: (e) => got.push(e.type), retryMs: 10,
    });
    await tick(); await tick(); await tick();
    expect(calls).toEqual([null, 5, 7]);
    expect(got).toEqual(["mensagem_recebida", "lead_criado"]);
    lp.stop();
  });

  it("catchUp: depois do primeiro contato avisa 'reconectado' (avisos podem ter se perdido antes)", async () => {
    const got: string[] = [];
    const lp = startLongPoll({ fetch: async (after) => (after === null ? { status: 200, cursor: 1, events: [] } : new Promise(() => {})), onEvent: (e) => got.push(e.type), retryMs: 10, catchUp: true });
    await tick(); await tick();
    expect(got).toEqual(["reconectado"]);
    lp.stop();
  });

  it("erro de rede: espera e tenta de novo com o mesmo cursor", async () => {
    vi.useFakeTimers();
    const calls: (number | null)[] = [];
    let n = 0;
    const lp = startLongPoll({
      fetch: async (after) => { calls.push(after); n++; if (n === 1) return { status: 200, cursor: 3, events: [] }; if (n === 2) throw new Error("rede"); return new Promise(() => {}); },
      onEvent: () => {}, retryMs: 3000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([null, 3]);
    await vi.advanceTimersByTimeAsync(2999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([null, 3, 3]);
    lp.stop(); vi.useRealTimers();
  });

  it("401 (saiu da conta): para de pedir", async () => {
    const fetch = vi.fn(async () => ({ status: 401 }) as PollResult);
    startLongPoll({ fetch, onEvent: () => {}, retryMs: 0 });
    await tick(); await tick(); await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("stop cancela a requisição em andamento e não pede mais", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(async (_a: number | null, s: AbortSignal) => { signal = s; return new Promise<PollResult>(() => {}); });
    const lp = startLongPoll({ fetch, onEvent: () => {}, retryMs: 0 });
    await tick();
    lp.stop();
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
