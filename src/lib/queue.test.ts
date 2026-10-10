import { describe, expect, it } from "vitest";
import { NEAR_SLA_RATIO, parseQueueView, queueHref, queueQuery, ringState, slaProgress } from "./queue";

describe("anel de SLA", () => {
  it("o limite de 'perto' é 50% do prazo", () => {
    expect(NEAR_SLA_RATIO).toBe(0.5);
    expect(ringState({ awaiting: true, late: false, waitSeconds: 59, slaMinutes: 2 })).toBe("ok");
    expect(ringState({ awaiting: true, late: false, waitSeconds: 60, slaMinutes: 2 })).toBe("near");
  });
  it("atrasado vem do alerta, não da conta; sem espera não há anel", () => {
    expect(ringState({ awaiting: true, late: true, waitSeconds: 1, slaMinutes: 2 })).toBe("late");
    expect(ringState({ awaiting: false, late: false, waitSeconds: 0, slaMinutes: 2 })).toBe("none");
    expect(ringState({ awaiting: true, late: false, waitSeconds: 500, slaMinutes: null })).toBe("ok"); // sem prazo na etapa
  });
  it("o progresso vai de 0 a 1 e trava no fim", () => {
    expect(slaProgress(30, 2)).toBe(0.25);
    expect(slaProgress(600, 2)).toBe(1);
    expect(slaProgress(10, null)).toBe(0);
  });
});

describe("URL da Fila", () => {
  it("monta a query sem parâmetros vazios e na ordem fixa", () => {
    expect(queueQuery({ q: "ana", view: "todos" })).toBe("view=todos&q=ana");
    expect(queueHref({})).toBe("/atendimento");
    expect(queueHref({ filtro: "atrasados", lead: "x" })).toBe("/atendimento?filtro=atrasados&lead=x");
  });
  it("visão desconhecida cai em todos", () => {
    expect(parseQueueView("lixo")).toBe("todos");
    expect(parseQueueView("sem-dono")).toBe("sem-dono");
  });
});
