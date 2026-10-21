import { describe, it, expect } from "vitest";
import { lateHref, waitingHref, staleHref, summaryLinkHref, parseQueueFilter, parseFunilFilter } from "./report-links";

describe("destinos de drill-down dos relatórios", () => {
  it("atrasados, esperando e parados abrem a Fila filtrada", () => {
    expect(lateHref()).toBe("/atendimento?filtro=atrasados");
    expect(waitingHref()).toBe("/atendimento?filtro=esperando");
    expect(staleHref()).toBe("/atendimento?filtro=parados");
    expect(staleHref("lead")).toBe("/atendimento?filtro=parados&etapa=lead");
  });
  it("leva junto a pessoa e a origem escolhidas na tela", () => {
    const scope = { dono: "u-1", fonte: "Não identificada" };
    expect(lateHref(scope)).toBe("/atendimento?filtro=atrasados&dono=u-1&fonte=N%C3%A3o+identificada");
    expect(staleHref("lead", scope)).toBe("/atendimento?filtro=parados&etapa=lead&dono=u-1&fonte=N%C3%A3o+identificada");
    expect(waitingHref({ dono: null, fonte: null })).toBe("/atendimento?filtro=esperando");
  });
  it("links do resumo: /atendimento e /funil antigo viram a Fila", () => {
    expect(summaryLinkHref("/atendimento?filtro=atrasados")).toBe("/atendimento?filtro=atrasados");
    expect(summaryLinkHref("/funil?filtro=esperando")).toBe("/atendimento?filtro=esperando");
    expect(summaryLinkHref("/funil?filtro=parados")).toBe("/atendimento?filtro=parados");
    expect(summaryLinkHref("/relatorios?periodo=hoje")).toBe("/relatorios?periodo=hoje");
  });
  it("tarefas atrasadas, agendados de amanhã e leads novos agora têm filtro", () => {
    expect(summaryLinkHref("/atendimento?filtro=tarefas-atrasadas")).toBe("/atendimento?filtro=tarefas-atrasadas");
    expect(summaryLinkHref("/atendimento?filtro=agendados-amanha")).toBe("/atendimento?filtro=agendados-amanha");
    expect(summaryLinkHref("/atendimento?filtro=novos")).toBe("/atendimento?filtro=novos");
  });
  it("filtro que ainda não existe não vira link enganoso", () => {
    expect(summaryLinkHref("/funil?filtro=cobrancas-amanha")).toBeNull();
    expect(parseQueueFilter("cobrancas-amanha")).toBeNull();
  });
  it("o Quadro entende só os três filtros antigos; a Fila entende todos", () => {
    expect(parseFunilFilter("novos")).toBeNull();
    expect(parseQueueFilter("novos")).toBe("novos");
  });
});
