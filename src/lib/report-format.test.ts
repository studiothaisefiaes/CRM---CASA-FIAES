import { describe, it, expect } from "vitest";
import { compareMetric, insufficientText, shareText, ticketText, MIN_SAMPLE } from "./report-format";

describe("compareMetric", () => {
  it("contagem: seta, variação relativa e tom só com amostra suficiente", () => {
    expect(compareMetric(30, 20, { kind: "count", n: 30, nPrev: 20 })).toMatchObject({ direction: "up", variation: "+50%", tone: "good", text: "↑ +50%" });
    expect(compareMetric(10, 20, { kind: "count", n: 40, nPrev: 40 })).toMatchObject({ direction: "down", variation: "−50%", tone: "bad" });
  });
  it("n < 20 em qualquer lado: seta e variação, mas sem cor de bom ou ruim", () => {
    expect(compareMetric(5, 3, { kind: "count", n: 5, nPrev: 3 })).toMatchObject({ direction: "up", tone: "neutral" });
    expect(compareMetric(30, 3, { kind: "count", n: 30, nPrev: 3 }).tone).toBe("neutral");
    expect(compareMetric(3, 30, { kind: "count", n: 3, nPrev: 30 }).tone).toBe("neutral");
    expect(MIN_SAMPLE).toBe(20);
  });
  it("porcentagem compara em pontos percentuais", () => {
    expect(compareMetric(80, 70, { kind: "pct", n: 50, nPrev: 50 })).toMatchObject({ variation: "+10 p.p.", tone: "good" });
    expect(compareMetric(60, 70, { kind: "pct", n: 50, nPrev: 50 })).toMatchObject({ variation: "−10 p.p.", tone: "bad" });
  });
  it("menor é melhor (tempo): subir é ruim", () => {
    expect(compareMetric(300, 120, { kind: "seconds", n: 40, nPrev: 40, lowerIsBetter: true })).toMatchObject({ direction: "up", tone: "bad", variation: "+150%" });
    expect(compareMetric(60, 120, { kind: "seconds", n: 40, nPrev: 40, lowerIsBetter: true })).toMatchObject({ direction: "down", tone: "good" });
  });
  it("igual fica neutro; anterior zero não inventa %; sem valor não compara", () => {
    expect(compareMetric(4, 4, { kind: "count", n: 40, nPrev: 40 })).toMatchObject({ direction: "flat", tone: "neutral", text: "→ igual" });
    expect(compareMetric(4, 0, { kind: "count", n: 4, nPrev: 0 })).toMatchObject({ direction: "up", variation: null, text: "↑ antes: 0" });
    expect(compareMetric(null, 4, { kind: "pct", n: 0, nPrev: 4 })).toMatchObject({ direction: "none", tone: "neutral", text: "sem comparação" });
    expect(compareMetric(4, null, { kind: "pct", n: 4, nPrev: 0 })).toMatchObject({ direction: "none", text: "sem comparação" });
  });
});

describe("amostra pequena", () => {
  it("texto de 'sem dados' mostra o n, nunca zero", () => {
    expect(insufficientText(3)).toBe("Sem dados suficientes (n = 3)");
    expect(insufficientText(0)).toBe("Sem dados suficientes (n = 0)");
  });
  it("% só com n >= 20; abaixo disso 'x de y'", () => {
    expect(shareText(3, 9)).toBe("3 de 9");
    expect(shareText(10, 20)).toBe("50%");
    expect(shareText(19, 19)).toBe("19 de 19");
    expect(shareText(0, 0)).toBeNull();
  });
  it("ticket nulo aparece como traço com o n, nunca R$ 0,00", () => {
    expect(ticketText(null, 0)).toBe("— (n = 0)");
    expect(ticketText(80_000, 2)).toBe("R$ 800 (n = 2)");
    expect(ticketText(null, 0)).not.toMatch(/R\$/);
  });
});

import { longSpan, PREVIOUS_LABEL } from "./report-format";
describe("duração e legenda", () => {
  it("longSpan", () => {
    expect(longSpan(null)).toBe("—"); expect(longSpan(30)).toBe("1 min"); expect(longSpan(2400)).toBe("40 min");
    expect(longSpan(18_000)).toBe("5 h"); expect(longSpan(3 * 86_400 + 50)).toBe("3 d");
  });
  it("hoje compara com ontem até a mesma hora", () => expect(PREVIOUS_LABEL.hoje).toBe("ontem até a mesma hora"));
});
