import { describe, it, expect } from "vitest";
import { lateHref, waitingHref, staleHref, summaryLinkHref } from "./report-links";

describe("destinos de drill-down dos relatórios", () => {
  it("atrasados abre o Funil filtrado (a Fila nasce na T15)", () => {
    expect(lateHref()).toBe("/funil?filtro=atrasados");
    expect(waitingHref()).toBe("/funil?filtro=esperando");
    expect(staleHref()).toBe("/funil?filtro=parados");
    expect(staleHref("lead")).toBe("/funil?filtro=parados&etapa=lead");
  });
  it("leva junto a pessoa e a origem escolhidas na tela", () => {
    const scope = { dono: "u-1", fonte: "Não identificada" };
    expect(lateHref(scope)).toBe("/funil?filtro=atrasados&dono=u-1&fonte=N%C3%A3o+identificada");
    expect(staleHref("lead", scope)).toBe("/funil?filtro=parados&etapa=lead&dono=u-1&fonte=N%C3%A3o+identificada");
    expect(waitingHref({ dono: null, fonte: null })).toBe("/funil?filtro=esperando");
  });
  it("links do resumo: /atendimento vira /funil enquanto a Fila não existe", () => {
    expect(summaryLinkHref("/atendimento?filtro=atrasados")).toBe("/funil?filtro=atrasados");
    expect(summaryLinkHref("/atendimento?filtro=esperando")).toBe("/funil?filtro=esperando");
    expect(summaryLinkHref("/funil?filtro=parados")).toBe("/funil?filtro=parados");
    expect(summaryLinkHref("/relatorios?periodo=hoje")).toBe("/relatorios?periodo=hoje");
  });
  it("filtro que ainda não existe não vira link enganoso", () => {
    expect(summaryLinkHref("/atendimento?filtro=tarefas-atrasadas")).toBeNull();
    expect(summaryLinkHref("/funil?filtro=agendados-amanha")).toBeNull();
    expect(summaryLinkHref("/funil?filtro=cobrancas-amanha")).toBeNull();
  });
});
