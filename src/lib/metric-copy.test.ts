import { describe, it, expect } from "vitest";
import { METRIC_COPY, readDelta } from "./metric-copy";

describe("explicação dos números", () => {
  it("cada número diz o que é, em uma frase, sem meta inventada", () => {
    for (const [k, v] of Object.entries(METRIC_COPY)) {
      expect(v.what, k).toMatch(/\.$/);
      expect(v.what.toLowerCase(), k).not.toMatch(/meta/);
    }
  });

  it("lê a comparação em português: subiu, desceu, igual, com a direção boa conforme o número", () => {
    expect(readDelta("leadsNovos", 18, 12, 30, 25, "ontem até a mesma hora")).toBe("Subiu de 12 para 18 em relação a ontem até a mesma hora. Bom sinal.");
    expect(readDelta("vendas", 3, 5, 25, 25, "os 7 dias anteriores")).toBe("Caiu de 5 para 3 em relação aos 7 dias anteriores. Vale olhar.");
    expect(readDelta("agendamentosMarcados", 4, 4, 30, 30, "os 7 dias anteriores")).toBe("Igual aos 7 dias anteriores (4).");
  });

  it("percentual fala em pontos; ticket em reais", () => {
    expect(readDelta("pctPrimeiraRespostaNoSla", 80, 70, 40, 40, "o mesmo tempo do mês anterior")).toBe("Subiu de 70% para 80% em relação ao mesmo tempo do mês anterior. Bom sinal.");
    expect(readDelta("ticketMedio", 25_000, 20_000, 22, 21, "os 7 dias anteriores")).toMatch(/^Subiu de R\$\s?200 para R\$\s?250 /);
  });

  it("poucos casos ou sem período anterior: não julga", () => {
    expect(readDelta("leadsNovos", 5, 3, 5, 3, "ontem até a mesma hora")).toBe("Subiu de 3 para 5 em relação a ontem até a mesma hora. Ainda são poucos casos (5) para tirar conclusão.");
  });

  it("muitos casos agora, poucos antes: diz que é a comparação que tem pouca base, sem jargão", () => {
    expect(readDelta("leadsNovos", 49, 6, 49, 6, "o mesmo tempo do mês anterior")).toBe("Subiu de 6 para 49 em relação ao mesmo tempo do mês anterior. O período anterior teve poucos casos (6) para comparar.");
    expect(readDelta("vendas", 2, null, 2, 0, "os 7 dias anteriores")).toBe("Primeiro período com dados para comparar.");
    expect(readDelta("leadsNovos", null, 3, 0, 3, "ontem")).toBe("Sem dados no período.");
  });
});
