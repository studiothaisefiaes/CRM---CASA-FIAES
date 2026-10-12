import { describe, it, expect } from "vitest";
import { businessDayLabel, businessInstantBefore, businessMinutesBetween, businessSecondsBetween, isOpen } from "./business-hours";

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

describe("businessInstantBefore (demonstração: posicionar esperas em relação ao agora)", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  it("no expediente, é só voltar o relógio", () => {
    // segunda 12/10/2026 10:00 em Salvador = 13:00Z
    expect(iso(businessInstantBefore(at("2026-10-12T13:00:00Z"), 600))).toBe("2026-10-12T12:50:00.000Z");
  });
  it("de madrugada, cai no fim do último expediente (sábado 17h)", () => {
    // segunda 02:00 em Salvador = 05:00Z; sábado 10/10 às 17:00 = 20:00Z; 10 min antes = 19:50Z
    expect(iso(businessInstantBefore(at("2026-10-12T05:00:00Z"), 600))).toBe("2026-10-10T19:50:00.000Z");
  });
  it("atravessa o fechamento: 5 min de segunda + 5 min de sábado", () => {
    expect(iso(businessInstantBefore(at("2026-10-12T11:05:00Z"), 600))).toBe("2026-10-10T19:55:00.000Z");
  });
  it("é o inverso de businessSecondsBetween", () => {
    for (const now of ["2026-10-12T05:00:00Z", "2026-10-12T11:01:30Z", "2026-10-14T22:59:00Z", "2026-10-11T15:00:00Z"]) {
      for (const s of [1, 75, 600, 1080]) {
        const from = businessInstantBefore(at(now), s);
        expect(businessSecondsBetween(from, at(now))).toBe(s);
        expect(isOpen(from)).toBe(true);
      }
    }
  });
});
