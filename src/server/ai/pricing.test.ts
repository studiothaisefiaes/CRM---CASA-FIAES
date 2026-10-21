import { describe, expect, it } from "vitest";
import { costMicros, formatUsd, HAIKU_PRICES } from "./pricing";

describe("custo da chamada (Haiku 5.5)", () => {
  it("usa os preços por milhão: entrada 0,10, cache leitura 0,01, cache escrita 0,125, saída 0,50", () => {
    expect(HAIKU_PRICES).toEqual({ input: 0.1, cacheRead: 0.01, cacheWrite: 0.125, output: 0.5 });
    // 1M de cada = US$ 0,735 = 735.000 micros
    expect(costMicros({ inputTokens: 1_000_000, cachedTokens: 1_000_000, cacheWriteTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(735_000);
  });
  it("uma chamada típica custa uma fração de centavo e arredonda para cima (nunca zero com tokens)", () => {
    expect(costMicros({ inputTokens: 800, cachedTokens: 2500, cacheWriteTokens: 0, outputTokens: 200 })).toBe(80 + 25 + 100);
    expect(costMicros({ inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBe(1);
    expect(costMicros({ inputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBe(0);
  });
  it("formata em dólar com vírgula", () => {
    expect(formatUsd(1_234_567)).toBe("US$ 1,23");
    expect(formatUsd(4_000)).toBe("US$ 0,004");
    expect(formatUsd(0)).toBe("US$ 0,00");
    expect(formatUsd(180)).toBe("US$ 0,00018");
  });
});
