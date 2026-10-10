import { describe, it, expect, vi, afterEach } from "vitest";
import { coalesce, scopesOf, shouldRefresh, SCOPE_OF, GLOBAL_SCOPES } from "@/lib/live-scope";
import { shouldRefresh as fromLive } from "./live";

describe("shouldRefresh", () => {
  it("é o mesmo que o provider exporta", () => expect(fromLive).toBe(shouldRefresh));

  it("mensagem de outro lead não atualiza o card aberto, mas atualiza a Fila", () => {
    const e = { type: "mensagem_recebida", dealId: "outro" };
    expect(shouldRefresh(e, ["deal:aberto"])).toBe(false);
    expect(shouldRefresh(e, ["queue"])).toBe(true);
  });

  it("mensagem do próprio lead atualiza o card aberto", () => {
    expect(shouldRefresh({ type: "mensagem_recebida", dealId: "aberto" }, ["deal:aberto"])).toBe(true);
  });

  it("mensagem não atualiza Relatórios, canais nem alertas", () => {
    const e = { type: "mensagem_recebida", dealId: "x" };
    expect(shouldRefresh(e, ["reports"])).toBe(false);
    expect(shouldRefresh(e, ["channels"])).toBe(false);
    expect(shouldRefresh(e, ["alerts"])).toBe(false);
  });

  it("alerta só mexe em alerts; canal só em channels", () => {
    expect(shouldRefresh({ type: "alerta" }, ["alerts"])).toBe(true);
    expect(shouldRefresh({ type: "alerta" }, ["queue", "reports", "channels"])).toBe(false);
    expect(shouldRefresh({ type: "canal_atualizado", status: "erro" }, ["channels"])).toBe(true);
    expect(shouldRefresh({ type: "canal_atualizado" }, ["queue", "reports"])).toBe(false);
  });

  it("venda e fechamento também atualizam Relatórios", () => {
    expect(shouldRefresh({ type: "etapa_alterada", dealId: "x" }, ["reports"])).toBe(true);
    expect(shouldRefresh({ type: "venda", dealId: "x" }, ["reports"])).toBe(true);
    expect(shouldRefresh({ type: "fechamento", dealId: "x" }, ["reports"])).toBe(true);
  });

  it("tipo desconhecido atualiza qualquer tela (fail-open), inclusive o card aberto", () => {
    const e = { type: "coisa_nova" };
    for (const s of [...GLOBAL_SCOPES, "deal:aberto"]) expect(shouldRefresh(e, [s])).toBe(true);
    expect(shouldRefresh(e, [])).toBe(false); // quem não assina nada não atualiza
  });

  it("regras expande os leads tocados", () => {
    const e = { type: "regras", deals: ["a", "b"] };
    expect(shouldRefresh(e, ["deal:b"])).toBe(true);
    expect(shouldRefresh(e, ["deal:c"])).toBe(false);
    expect(shouldRefresh(e, ["alerts"])).toBe(true);
  });

  it("o escopo declarado no aviso (emit) vale mais que o mapa", () => {
    expect(shouldRefresh({ type: "mensagem_recebida", scope: ["reports"] }, ["queue"])).toBe(false);
    expect(shouldRefresh({ type: "mensagem_recebida", scope: "reports" }, ["reports"])).toBe(true);
  });

  it("todo tipo do mapa tem pelo menos um escopo", () => {
    for (const [t, s] of Object.entries(SCOPE_OF)) expect(s.length, t).toBeGreaterThan(0);
  });

  it("scopesOf troca <id> pelo dealId", () => {
    expect(scopesOf({ type: "lead_atualizado", dealId: "z" })).toEqual(["queue", "deal:z"]);
    expect(scopesOf({ type: "status_mensagem" })).toEqual(["queue"]);
  });
});

describe("coalesce", () => {
  afterEach(() => vi.useRealTimers());

  it("20 chamadas em rajada viram 1", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = coalesce(fn, 400);
    for (let i = 0; i < 20; i++) { call(); vi.advanceTimersByTime(50); }
    expect(fn).not.toHaveBeenCalled(); // a janela reinicia a cada chamada
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("fluxo contínuo a cada 100 ms por 5 s não fica adiando: sai a cada 2 s (maxWait)", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = coalesce(fn, 400, 2000);
    for (let t = 0; t < 5000; t += 100) { call(); vi.advanceTimersByTime(100); }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("com maxWait, uma rajada curta continua virando 1 só", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = coalesce(fn, 400, 2000);
    for (let i = 0; i < 20; i++) { call(); vi.advanceTimersByTime(30); }
    vi.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rajadas separadas chamam de novo e cancel descarta a pendente", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const call = coalesce(fn, 400);
    call(); vi.advanceTimersByTime(500);
    call(); vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
    call(); call.cancel(); vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
