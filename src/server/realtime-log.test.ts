import { describe, it, expect, vi, afterEach } from "vitest";
import { createEventLog } from "./realtime-log";

describe("registro de avisos para o long-polling", () => {
  afterEach(() => vi.useRealTimers());

  it("devolve na hora o que chegou depois do cursor", async () => {
    const log = createEventLog(10);
    const c = log.cursor();
    log.push("a"); log.push("b");
    expect(await log.wait(c, 1000)).toEqual({ cursor: c + 2, events: ["a", "b"], gap: false });
  });

  it("sem nada novo, segura a resposta até chegar um aviso", async () => {
    const log = createEventLog(10);
    const p = log.wait(log.cursor(), 25_000);
    setTimeout(() => log.push("x"), 20);
    const t0 = Date.now();
    expect((await p).events).toEqual(["x"]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("estoura o prazo sem aviso: devolve vazio com o mesmo cursor", async () => {
    vi.useFakeTimers();
    const log = createEventLog(10);
    const p = log.wait(log.cursor(), 25_000);
    vi.advanceTimersByTime(25_000);
    expect(await p).toEqual({ cursor: 0, events: [], gap: false });
  });

  it("cursor velho demais (avisos já descartados) ou de outro processo (reinício): avisa que houve buraco", async () => {
    const log = createEventLog(2);
    log.push("1"); log.push("2"); log.push("3");
    expect((await log.wait(0, 10)).gap).toBe(true); // o "1" saiu do registro
    expect((await log.wait(1, 10))).toEqual({ cursor: 3, events: ["2", "3"], gap: false });
    expect((await log.wait(99, 10))).toMatchObject({ cursor: 3, gap: true }); // servidor reiniciou e o contador voltou
  });

  it("a conexão que cai (abort) libera a espera", async () => {
    const log = createEventLog(10);
    const ac = new AbortController();
    const p = log.wait(log.cursor(), 25_000, ac.signal);
    ac.abort();
    expect((await p).events).toEqual([]);
    expect(log.waiting()).toBe(0);
  });
});
