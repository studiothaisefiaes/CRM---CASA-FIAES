import { describe, expect, it } from "vitest";
import { NEAR_SLA_RATIO, offStage, parseQueueView, queueHref, queueQuery, ringState, slaLevel, slaProgress, slaStatus } from "./queue";

describe("regra única do prazo", () => {
  it("'quase no prazo' é 60% do prazo, em todas as telas", () => {
    expect(NEAR_SLA_RATIO).toBe(0.6);
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 71, slaMinutes: 2 })).toBe("ok");
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 72, slaMinutes: 2 })).toBe("near");
  });
  it("vermelho só com alerta: passou do prazo sem alerta é 'over' (dourado)", () => {
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 360, slaMinutes: 2 })).toBe("over");
    expect(slaLevel({ awaiting: true, alert: true, waitSeconds: 1, slaMinutes: 2 })).toBe("late");
    expect(slaLevel({ awaiting: false, alert: false, waitSeconds: 0, slaMinutes: 2 })).toBe("none");
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: 500, slaMinutes: null })).toBe("ok");
    expect(ringState({ awaiting: true, late: false, waitSeconds: 360, slaMinutes: 2 })).toBe("near");
    expect(ringState({ awaiting: true, late: true, waitSeconds: 1, slaMinutes: 2 })).toBe("late");
  });
  it("um texto de prazo só, com o tom da regra", () => {
    const at = (waitSeconds: number, alert = false) => slaStatus({ ring: ringState({ awaiting: true, late: alert, waitSeconds, slaMinutes: 2 }), alert, waitSeconds, slaMinutes: 2 });
    expect(at(360)).toEqual({ text: "Passou 4 min do prazo", tone: "near" });
    expect(at(360, true)).toEqual({ text: "Passou 4 min do prazo", tone: "late" });
    expect(at(90)).toEqual({ text: "Responda em menos de 1 min", tone: "near" }); // faltam 30 s
    expect(at(30)).toEqual({ text: "Responda em 2 min", tone: "ok" });
    expect(slaStatus({ ring: "none", alert: false, waitSeconds: 0, slaMinutes: 2 })).toBeNull();
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

describe("etapa na linha da Fila", () => {
  it("só aparece quando não é a esperada para a seção", () => {
    for (const s of ["atrasados", "perto", "aguardando"] as const) {
      expect(offStage(s, "lead")).toBe(false);
      expect(offStage(s, "atendimento")).toBe(false);
      expect(offStage(s, "agendado")).toBe(true);
      expect(offStage(s, "followup")).toBe(true);
    }
    expect(offStage("aguardando-cliente", "followup")).toBe(false);
    expect(offStage("aguardando-cliente", "proposta")).toBe(false);
    expect(offStage("aguardando-cliente", "agendado")).toBe(true);
    expect(offStage("parados", "atendido")).toBe(true);
    expect(offStage("acoes-hoje", "atendimento")).toBe(false);
    expect(offStage("reengajar", "perdido")).toBe(false);
    expect(offStage("arquivadas", "fechado")).toBe(false);
    expect(offStage("aguardando", undefined)).toBe(false); // sem o tipo da etapa, não inventa
  });
});
