import { describe, expect, it } from "vitest";
import { bahiaDay, bahiaHour, planReports, weeklyDue } from "./plan";
import { rolesOf } from "../formats";

// 18/10/2026 23:30 em Salvador = 19/10 02:30 UTC
const now = new Date("2026-10-19T02:30:00Z");

describe("plano do robô", () => {
  it("usa o dia e a hora de Salvador (UTC-3)", () => {
    expect(bahiaDay(now)).toBe("2026-10-18");
    expect(bahiaHour(new Date("2026-10-18T23:00:00Z"))).toBe(20);
  });
  it("diário: reservas de ontem a 30 dias; pagamentos e itens dos últimos 7 dias; sem os completos", () => {
    const p = planReports(now, { weekly: false });
    const by = (c: string) => p.find((r) => r.code === c)!;
    expect(by("0051").params).toEqual({ inicio: "17/10/2026", fim: "17/11/2026" });
    expect(by("0186").params).toEqual({ inicio: "11/10/2026", fim: "18/10/2026" });
    expect(by("0388").params).toEqual({ inicio: "11/10/2026", fim: "18/10/2026" });
    expect(by("0248").params.status).toBe("1");
    expect(p.some((r) => r.weekly)).toBe(false);
  });
  it("semanal inclui cadastros e pacotes completos", () => {
    const codes = planReports(now, { weekly: true }).map((r) => r.code);
    for (const c of ["0004", "0063", "0229", "0033", "0051"]) expect(codes).toContain(c);
  });
  it("--so filtra", () => { expect(planReports(now, { weekly: false, only: ["0004"] }).map((r) => r.code)).toEqual(["0004"]); });
  it("1x por semana", () => {
    expect(weeklyDue(null, "2026-10-18")).toBe(true);
    expect(weeklyDue("2026-10-12", "2026-10-18")).toBe(false);
    expect(weeklyDue("2026-10-11", "2026-10-18")).toBe(true);
  });
  it("cada relatório planejado tem um papel que o importador reconhece", () => {
    const cols: Record<string, string[]> = {
      agendamentos: ["Data Reserva", "Hora", "Cliente"], bloqueios: ["Data inicial", "Data final", "Hora inicial", "Hora final"],
      cancelamentos: ["Cancelamento", "Cliente", "Serviço"], pagamentos: ["Comanda", "Cliente", "Valor", "Forma de Pagamento", "Data Pagamento"],
    };
    for (const [role, h] of Object.entries(cols)) expect(rolesOf(h)).toContain(role);
  });
});
