import { describe, expect, it } from "vitest";
import { SUMMARY_HOUR, summaryMode } from "./daily-summary";

// Salvador é UTC-3 o ano todo: 19h lá = 22h UTC.
const bahia = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m));

describe("summaryMode (a regra das 19h)", () => {
  it("antes das 19h o resumo fica recolhido, como 'Resumo até agora'", () => {
    expect(summaryMode(bahia(10))).toEqual({ highlight: false, title: "Resumo até agora" });
    expect(summaryMode(bahia(18, 59))).toMatchObject({ highlight: false, title: "Resumo até agora" });
  });
  it("a partir das 19h (America/Bahia) vira 'Resumo do dia', em destaque", () => {
    expect(SUMMARY_HOUR).toBe(19);
    expect(summaryMode(bahia(19))).toEqual({ highlight: true, title: "Resumo do dia" });
    expect(summaryMode(bahia(23, 59))).toMatchObject({ highlight: true });
  });
  it("usa o relógio de Salvador, não o UTC: 21h UTC (18h lá) ainda é 'até agora'; 22h UTC (19h lá) já é destaque", () => {
    expect(summaryMode(new Date(Date.UTC(2026, 9, 13, 21, 59))).highlight).toBe(false);
    expect(summaryMode(new Date(Date.UTC(2026, 9, 13, 22, 0))).highlight).toBe(true);
  });
  it("meia-noite em Salvador volta a ser 'até agora' (dia novo)", () => {
    expect(summaryMode(bahia(24, 0)).highlight).toBe(false);
    expect(summaryMode(bahia(0, 30)).highlight).toBe(false);
  });
});
