import { describe, it, expect } from "vitest";
import { businessDayLabel, businessMinutesBetween, isOpen } from "./business-hours";

const at = (iso: string) => new Date(iso).getTime(); // horários em UTC; Salvador = UTC-3

describe("horário de atendimento", () => {
  it("conta só o expediente", () => {
    // sex 09/10 19:55 local (22:55Z) → sáb 10/10 08:03 local (11:03Z): 5 min na sexta + 3 min no sábado
    expect(businessMinutesBetween(at("2026-10-09T22:55:00Z"), at("2026-10-10T11:03:00Z"))).toBe(8);
  });
  it("domingo não conta", () => {
    // sáb 16:58 local → seg 08:01 local
    expect(businessMinutesBetween(at("2026-10-10T19:58:00Z"), at("2026-10-12T11:01:00Z"))).toBe(3);
  });
  it("dentro do expediente é o tempo normal", () => {
    expect(businessMinutesBetween(at("2026-10-09T13:00:00Z"), at("2026-10-09T13:02:30Z"))).toBe(2);
  });
  it("aberto ou fechado", () => {
    expect(isOpen(at("2026-10-09T13:00:00Z"))).toBe(true);  // sex 10h
    expect(isOpen(at("2026-10-11T13:00:00Z"))).toBe(false); // dom
    expect(isOpen(at("2026-10-10T02:00:00Z"))).toBe(false); // sex 23h
  });
});

describe("businessDayLabel", () => {
  it("diz o expediente do dia para avisar o agendamento fora do horário", () => {
    expect(businessDayLabel(at("2026-10-10T21:00:00Z"))).toBe("sábado, das 8:00 às 17:00"); // sáb 18:00 local
    expect(businessDayLabel(at("2026-10-11T15:00:00Z"))).toBe("domingo, a Casa não abre");
    expect(businessDayLabel(at("2026-10-07T17:00:00Z"))).toBe("quarta, das 8:00 às 20:00");
  });
});
