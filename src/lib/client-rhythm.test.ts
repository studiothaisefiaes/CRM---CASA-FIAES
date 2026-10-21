import { describe, expect, it } from "vitest";
import { addDaysTo, bahiaDay, daysUntilBirthday, displayName, reminderDueAt, returnInfo, returnLine } from "./client-rhythm";

const TODAY = "2026-10-15";
const base = { rhythmDays: 40, cycleDays: null, hasFuture: false };
const visit = (daysAgo: number) => addDaysTo(TODAY, -daysAgo);

describe("returnInfo", () => {
  it("bordas do ritmo: 0,8× e 1,5× ainda são 'na hora'; 1 dia além de 1,5× é 'sumida'; 365 dias é 'antiga'", () => {
    expect(returnInfo({ ...base, lastVisitOn: visit(31) }, TODAY)?.status).toBe("em_dia");   // 31 < 32
    expect(returnInfo({ ...base, lastVisitOn: visit(32) }, TODAY)?.status).toBe("na_hora");  // 0,8 × 40
    expect(returnInfo({ ...base, lastVisitOn: visit(60) }, TODAY)?.status).toBe("na_hora");  // 1,5 × 40
    expect(returnInfo({ ...base, lastVisitOn: visit(61) }, TODAY)?.status).toBe("sumida");
    expect(returnInfo({ ...base, lastVisitOn: visit(364) }, TODAY)?.status).toBe("sumida");
    expect(returnInfo({ ...base, lastVisitOn: visit(365) }, TODAY)?.status).toBe("antiga");
    expect(returnInfo({ ...base, lastVisitOn: visit(61), hasFuture: true }, TODAY)?.status).toBe("agendada");
  });
  it("sem ritmo usa o ciclo do serviço; sem os dois, não há previsão", () => {
    const r = returnInfo({ lastVisitOn: visit(10), rhythmDays: null, cycleDays: 30, hasFuture: false }, TODAY);
    expect(r).toMatchObject({ basis: "ciclo", everyDays: 30, dueOn: "2026-11-04", lateDays: 0, status: "em_dia" });
    expect(returnInfo({ lastVisitOn: visit(10), rhythmDays: null, cycleDays: null, hasFuture: false }, TODAY)).toBeNull();
    expect(returnInfo({ lastVisitOn: null, rhythmDays: 40, cycleDays: null, hasFuture: false }, TODAY)).toBeNull();
  });
  it("frase do retorno, como na spec", () => {
    expect(returnLine(returnInfo({ lastVisitOn: "2026-09-18", rhythmDays: 45, cycleDays: null, hasFuture: false }, "2026-11-14")!, "2026-11-14"))
      .toBe("Volta a cada ~45 dias · prevista 02/11 · atrasada 12 dias");
    expect(returnLine(returnInfo({ lastVisitOn: visit(10), rhythmDays: null, cycleDays: 30, hasFuture: false }, TODAY)!, TODAY))
      .toBe("Pelo ciclo do serviço, a cada 30 dias · prevista 04/11 · faltam 20 dias");
    expect(returnLine(returnInfo({ lastVisitOn: visit(39), rhythmDays: 40, cycleDays: null, hasFuture: false }, TODAY)!, TODAY))
      .toBe("Volta a cada ~40 dias · prevista 16/10 · falta 1 dia");
  });
});

describe("datas de Salvador", () => {
  it("o dia muda à meia-noite de Salvador, não de UTC", () => {
    expect(bahiaDay(Date.parse("2026-10-16T02:30:00Z"))).toBe("2026-10-15");
    expect(bahiaDay(Date.parse("2026-10-16T03:00:00Z"))).toBe("2026-10-16");
  });
  it("aniversário: dias até o próximo; 29/02 cai em 28/02 em ano não bissexto", () => {
    expect(daysUntilBirthday(15, 10, TODAY)).toBe(0);
    expect(daysUntilBirthday(14, 10, TODAY)).toBe(364);
    expect(daysUntilBirthday(29, 2, "2027-02-27")).toBe(1);
    expect(daysUntilBirthday(29, 2, "2028-02-28")).toBe(1);
  });
  it("Lembrar: no dia previsto às 10h; já passou ou sem previsão, amanhã às 10h", () => {
    const now = Date.parse("2026-10-15T15:00:00Z");
    expect(reminderDueAt("2026-11-02", now).toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(reminderDueAt("2026-10-01", now).toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(reminderDueAt(null, now).toISOString()).toBe("2026-10-16T13:00:00.000Z");
  });
  it("nome de profissional do Avec em maiúsculas vira nome próprio; nome já escrito fica", () => {
    expect(displayName("MAIARA")).toBe("Maiara");
    expect(displayName("ANA PAULA")).toBe("Ana Paula");
    expect(displayName("Maiara Souza")).toBe("Maiara Souza");
    expect(displayName("  ")).toBeNull();
  });
});
