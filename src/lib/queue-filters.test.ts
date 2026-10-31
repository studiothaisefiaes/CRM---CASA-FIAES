import { describe, expect, it } from "vitest";
import { activeFilters, queueTab, tabHref } from "./queue-filters";

describe("abas da Fila: só Todas, Não lidas e Resolvidas", () => {
  it("a aba vem da URL: Resolvidas é view=resolvidas (e as antigas arquivadas/encerradas); Não lidas é aba=nao-lidas; o resto é Todas", () => {
    expect(queueTab({})).toBe("todas");
    expect(queueTab({ view: "meus" })).toBe("todas");
    expect(queueTab({ aba: "nao-lidas", view: "meus" })).toBe("nao-lidas");
    expect(queueTab({ view: "arquivadas" })).toBe("resolvidas");
    expect(queueTab({ view: "resolvidas" })).toBe("resolvidas");
    expect(queueTab({ view: "encerradas" })).toBe("resolvidas");
  });

  it("trocar de aba mantém os filtros (menos nas Resolvidas, que é outra lista) e nunca deixa a URL vazia", () => {
    const p = { view: "meus", foco: "atrasados", etiqueta: "t1", q: "ana" };
    expect(tabHref("nao-lidas", p)).toBe("/atendimento?view=meus&aba=nao-lidas&foco=atrasados&etiqueta=t1&q=ana");
    expect(tabHref("todas", { ...p, aba: "nao-lidas" })).toBe("/atendimento?view=meus&foco=atrasados&etiqueta=t1&q=ana");
    // As abas Esperando e Para retomar são focos: ligar uma troca o foco; sair dela tira (20/10).
    expect(tabHref("esperando", p)).toBe("/atendimento?view=meus&foco=aguardando&etiqueta=t1&q=ana");
    expect(tabHref("todas", { ...p, foco: "aguardando" })).toBe("/atendimento?view=meus&etiqueta=t1&q=ana");
    expect(tabHref("resolvidas", p)).toBe("/atendimento?view=resolvidas&etiqueta=t1&q=ana");
    // Sem filtro nenhum: "view=todos" segura a Fila (sem parâmetro, ela volta aos filtros da última vez).
    expect(tabHref("todas", { view: "arquivadas" })).toBe("/atendimento?view=todos");
  });
});

describe("filtros ligados viram chips com ✕", () => {
  it("cada filtro ligado tem um nome curto e um link que tira só ele", () => {
    const chips = activeFilters({ view: "meus", foco: "atrasados", etapa: "lead", dono: "u1", etiqueta: "t1", q: "ana" }, { etapa: "Novo contato", dono: "Sara Lima", etiqueta: "VIP" });
    expect(chips.map((c) => [c.label, c.href])).toEqual([
      ["Minhas", "/atendimento?foco=atrasados&etapa=lead&dono=u1&etiqueta=t1&q=ana"],
      ["Atrasados", "/atendimento?view=meus&etapa=lead&dono=u1&etiqueta=t1&q=ana"],
      ["Etapa: Novo contato", "/atendimento?view=meus&foco=atrasados&dono=u1&etiqueta=t1&q=ana"],
      ["Dona: Sara Lima", "/atendimento?view=meus&foco=atrasados&etapa=lead&etiqueta=t1&q=ana"],
      ["Etiqueta: VIP", "/atendimento?view=meus&foco=atrasados&etapa=lead&dono=u1&q=ana"],
    ]);
  });

  it("as abas e a busca não são chips; tirar o último filtro volta para Todas", () => {
    expect(activeFilters({ aba: "nao-lidas", q: "x" }, {})).toEqual([]);
    expect(activeFilters({ view: "arquivadas" }, {})).toEqual([]);
    expect(activeFilters({ view: "sem-dono" }, {})).toEqual([{ key: "view", label: "Sem dono", href: "/atendimento?view=todos" }]);
  });

  it("link de relatório: o filtro do relatório e a origem também viram chips (com 'só as suas' para a atendente)", () => {
    const chips = activeFilters({ filtro: "esperando", fonte: "Instagram" }, {}, { onlyOwn: true });
    expect(chips.map((c) => c.label)).toEqual(["Conversas esperando resposta (só as suas)", "Origem: Instagram"]);
  });

  it("etapa, dona ou etiqueta sem nome conhecido ainda aparecem (com o que veio na URL), para poder tirar", () => {
    expect(activeFilters({ etapa: "followup" }, { etapa: null }).map((c) => c.label)).toEqual(["Etapa: followup"]);
    expect(activeFilters({ dono: "u9" }, {}).map((c) => c.label)).toEqual(["Dona: outra pessoa"]);
  });
});

describe("filtros finos: etiquetas com regra, sem dona e dias sem conversar", () => {
  it("cada um vira um chip com o link que tira só ele (e a regra vai junto com as etiquetas)", () => {
    const p = { etiquetas: "t1,t2", regra: "todas", dono: "sem", dias: "30", q: "ana" };
    const chips = activeFilters(p, { etiquetas: ["Método", "Noiva"] });
    expect(chips.map((c) => [c.label, c.href])).toEqual([
      ["Sem dona", "/atendimento?etiquetas=t1%2Ct2&regra=todas&dias=30&q=ana"],
      ["Etiquetas: Método, Noiva (todas)", "/atendimento?dono=sem&dias=30&q=ana"],
      ["30 dias sem conversar", "/atendimento?dono=sem&etiquetas=t1%2Ct2&regra=todas&q=ana"],
    ]);
  });
  it("Não tem e Qualquer têm o texto certo; etiqueta removida não quebra", () => {
    expect(activeFilters({ etiquetas: "t1", regra: "nao_tem" }, { etiquetas: ["Horário marcado"] })[0].label).toBe("Sem as etiquetas: Horário marcado");
    expect(activeFilters({ etiquetas: "t1" }, { etiquetas: [null] })[0].label).toBe("Etiquetas: removida (qualquer)");
    expect(activeFilters({ dias: "1" }, {})[0].label).toBe("1 dia sem conversar");
  });
});

describe("filtro 'Veio de anúncio' (26/10)", () => {
  it("chip com o nome da campanha (ou 'Veio de anúncio' / 'Não veio de anúncio') e o link que tira só ele", () => {
    expect(activeFilters({ anuncio: "sim", etapa: "lead" }, { etapa: "Lead" }).map((c) => [c.label, c.href]))
      .toEqual([["Etapa: Lead", "/atendimento?anuncio=sim"], ["Veio de anúncio", "/atendimento?etapa=lead"]]);
    expect(activeFilters({ anuncio: "nao" }, {})[0].label).toBe("Não veio de anúncio");
    expect(activeFilters({ anuncio: "111" }, { anuncio: "Método Fiaes" })[0].label).toBe("Anúncio: Método Fiaes");
    expect(activeFilters({ anuncio: "111" }, {})[0].label).toBe("Anúncio: arquivado ou sem conversa");
    expect(tabHref("nao-lidas", { anuncio: "sim" })).toBe("/atendimento?aba=nao-lidas&anuncio=sim");
  });
});
