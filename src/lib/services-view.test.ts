import { describe, expect, it } from "vitest";
import { durationText, groupServices, prettyCategory, prettyName } from "./services-view";

const s = (label: string, category: string | null, extra: Partial<{ active: boolean; description: string | null }> = {}) => ({ id: label, label, category, active: true, description: null, ...extra });

describe("nomes sem maiúsculas gritadas", () => {
  it("categoria do Avec vira nome bonito, com acento", () => {
    expect(prettyCategory("METODO FIAES")).toBe("Método Fiaes®");
    expect(prettyCategory("MANICURE E PEDICURE")).toBe("Manicure e pedicure");
    expect(prettyCategory("QUIMICA (ALTA PERFORMANCE)")).toBe("Química (alta performance)");
    expect(prettyCategory("Cabelo")).toBe("Cabelo");
    expect(prettyCategory(null)).toBe("Sem categoria");
  });
  it("nome todo em maiúsculas vira frase; nome já escrito fica como está", () => {
    expect(prettyName("MANUTENÇÃO PROTESE CAPILAR")).toBe("Manutenção prótese capilar");
    expect(prettyName("Corte Thaise Fiaes")).toBe("Corte Thaise Fiaes");
  });
});

describe("duração", () => {
  it("em horas e minutos", () => {
    expect(durationText(45)).toBe("45 min");
    expect(durationText(60)).toBe("1 h");
    expect(durationText(90)).toBe("1 h 30");
    expect(durationText(null)).toBe("Sem duração");
  });
});

describe("agrupar e buscar", () => {
  const all = [s("Corte", "CABELO"), s("Manutenção Método Fiaes", "METODO FIAES"), s("Mãos", "MANICURE E PEDICURE"), s("Escova", null), s("Velho", "CABELO", { active: false })];
  it("Método Fiaes primeiro, depois por nome; sem categoria no fim; desativados só quando pedidos", () => {
    const g = groupServices(all, "", false);
    expect(g.map((x) => x.label)).toEqual(["Método Fiaes®", "Cabelo", "Manicure e pedicure", "Sem categoria"]);
    expect(g[1].items.map((i) => i.label)).toEqual(["Corte"]);
    expect(groupServices(all, "", true)[1].items.map((i) => i.label)).toEqual(["Corte", "Velho"]);
  });
  it("busca sem acento por nome, categoria e descrição", () => {
    expect(groupServices(all, "metodo", false).flatMap((x) => x.items.map((i) => i.label))).toEqual(["Manutenção Método Fiaes"]);
    expect(groupServices(all, "pedicure", false).flatMap((x) => x.items.map((i) => i.label))).toEqual(["Mãos"]);
    expect(groupServices([s("Lavagem", null, { description: "Com massagem" })], "massagem", false)[0].items).toHaveLength(1);
  });
});

describe("pacotes", () => {
  it("sessões e validade em texto", async () => {
    const { sessionsText, packageValidityText } = await import("./services-view");
    expect([sessionsText(1), sessionsText(4)]).toEqual(["1 sessão", "4 sessões"]);
    expect([packageValidityText(null), packageValidityText(90), packageValidityText(365), packageValidityText(730)]).toEqual(["Sem validade", "Vale 90 dias", "Vale 1 ano", "Vale 2 anos"]);
  });
});
