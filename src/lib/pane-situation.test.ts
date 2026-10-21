import { describe, expect, it } from "vitest";
import { paneSituation } from "./pane-situation";

const NOW = Date.parse("2026-10-15T13:00:00Z"); // 10:00 em Salvador
const ctx = { isFirstContact: false, firstContactAt: "2023-03-01T12:00:00Z", knownSince: "2023-03-01T12:00:00Z", lastVisit: { at: "2026-09-25T15:00:00Z" }, activePackage: { packageName: "Método", usedSessions: 3, totalSessions: 4 }, retorno: null };

describe("Situação numa frase (painel da cliente)", () => {
  it("cliente desde, pacote e última visita (a espera fica na linha do prazo logo abaixo: uma informação por lugar)", () => {
    expect(paneSituation(ctx, { isClient: true }, NOW)).toBe("Cliente desde 2023 · pacote 3 de 4 · última visita há 20 dias");
  });
  it("primeira conversa e sem visita", () => {
    expect(paneSituation({ ...ctx, isFirstContact: true, lastVisit: null, activePackage: null }, { isClient: false }, NOW)).toBe("Primeira conversa · ainda não veio à Casa");
  });
  it("quem já falou com a Casa mas não é cliente: desde quando fala; na hora de voltar entra no fim", () => {
    const r = { basis: "ritmo", everyDays: 25, dueOn: "2026-10-11", daysSince: 20, lateDays: 4, status: "na_hora" } as const;
    expect(paneSituation({ ...ctx, activePackage: null, retorno: r }, { isClient: false }, NOW)).toBe("Fala com a Casa desde mar/2023 · última visita há 20 dias · hora de voltar");
  });
});
