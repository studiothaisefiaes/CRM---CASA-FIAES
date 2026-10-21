import { describe, expect, it } from "vitest";
import { appointmentLine, brDay, groupHistory, packageLine, packagePercent, PACKAGE_SITUATION_LABEL } from "./client-avec";

// 14/10/2026 12:00 em Salvador
const NOW = Date.UTC(2026, 9, 14, 15, 0);

describe("textos do Avec na ficha e na conversa", () => {
  it("próximo horário: quando, serviço e profissional numa linha", () => {
    expect(appointmentLine({ startsAt: new Date(Date.UTC(2026, 9, 15, 17, 30)).toISOString(), serviceLabel: "Escova", professionalName: "MAIARA" }, NOW))
      .toBe("amanhã 14:30 · Escova · com MAIARA");
    expect(appointmentLine({ startsAt: new Date(Date.UTC(2026, 9, 20, 12, 0)).toISOString(), serviceLabel: "Corte", professionalName: null }, NOW))
      .toBe("ter 20/10 09:00 · Corte");
  });

  it("pacote: X de Y sessões (sessão no singular quando o total é 1)", () => {
    expect(packageLine({ packageName: "Hidratação 10x", usedSessions: 3, totalSessions: 10 })).toBe("Hidratação 10x · 3 de 10 sessões");
    expect(packageLine({ packageName: "Avaliação", usedSessions: 0, totalSessions: 1 })).toBe("Avaliação · 0 de 1 sessão");
  });

  it("barra de sessões: porcentagem usada, entre 0 e 100", () => {
    expect(packagePercent(3, 10)).toBe(30);
    expect(packagePercent(12, 10)).toBe(100);
    expect(packagePercent(0, 0)).toBe(0);
  });

  it("situação do pacote em palavras simples", () => {
    expect(PACKAGE_SITUATION_LABEL.acabando).toBe("Falta 1 sessão");
    expect(PACKAGE_SITUATION_LABEL.esgotado).toBe("Sessões usadas");
  });

  it("data do Avec (aaaa-mm-dd) no jeito daqui", () => {
    expect(brDay("2026-10-05")).toBe("05/10/2026");
    expect(brDay(null)).toBe("—");
  });

  it("histórico agrupado por dia (mais novo primeiro); total do dia só quando há valores", () => {
    const items = [
      { id: "1", soldOn: "2026-10-10", item: "Corte", professionalName: "MAIARA", totalCents: 8_000, fromPackage: false },
      { id: "2", soldOn: "2026-10-10", item: "Escova", professionalName: "JU", totalCents: 5_000, fromPackage: false },
      { id: "3", soldOn: "2026-09-01", item: "Hidratação", professionalName: null, totalCents: null, fromPackage: true },
    ];
    const g = groupHistory(items);
    expect(g.map((d) => [d.day, d.items.length, d.totalCents])).toEqual([["2026-10-10", 2, 13_000], ["2026-09-01", 1, null]]);
    expect(groupHistory(items.map((i) => ({ ...i, totalCents: null })))[0].totalCents).toBeNull();
  });
});
