import { describe, expect, it } from "vitest";
import { bahiaParts, checkSlot, defaultSlot, slotMs } from "./schedule";
import { DEFAULT_HOURS } from "./business-hours";

const bahia = (iso: string) => Date.parse(`${iso}-03:00`);

describe("agendar", () => {
  it("lê a data e a hora no relógio de Salvador", () => {
    expect(slotMs("2026-10-10", "10:00")).toBe(Date.parse("2026-10-10T13:00:00Z"));
    expect(Number.isNaN(slotMs("", "10:00"))).toBe(true);
    expect(bahiaParts(Date.parse("2026-10-10T13:00:00Z"))).toEqual({ date: "2026-10-10", time: "10:00" });
  });

  it("horário que já passou é erro; incompleto também", () => {
    const now = bahia("2026-10-07T12:00:00");
    expect(checkSlot(bahia("2026-10-07T11:00:00"), now, DEFAULT_HOURS)).toEqual({ ok: false, error: "Esse horário já passou. Escolha um horário futuro." });
    expect(checkSlot(NaN, now, DEFAULT_HOURS)).toEqual({ ok: false, error: "Escolha a data e o horário." });
  });

  it("dentro do expediente não avisa; fora, avisa com o expediente do dia mas deixa agendar", () => {
    const now = bahia("2026-10-07T12:00:00");
    expect(checkSlot(bahia("2026-10-08T10:00:00"), now, DEFAULT_HOURS)).toEqual({ ok: true, outsideHours: null });
    expect(checkSlot(bahia("2026-10-10T18:00:00"), now, DEFAULT_HOURS)).toEqual({ ok: true, outsideHours: "Fora do horário de atendimento (sábado, das 8:00 às 17:00). Dá para agendar mesmo assim." });
    expect(checkSlot(bahia("2026-10-11T10:00:00"), now, DEFAULT_HOURS)).toEqual({ ok: true, outsideHours: "Fora do horário de atendimento (domingo, a Casa não abre). Dá para agendar mesmo assim." });
  });

  it("a sugestão pula os dias fechados e respeita o horário marcado", () => {
    expect(defaultSlot(bahia("2026-10-09T15:00:00"), DEFAULT_HOURS)).toEqual({ date: "2026-10-10", time: "10:00" }); // sexta → sábado
    expect(defaultSlot(bahia("2026-10-10T15:00:00"), DEFAULT_HOURS)).toEqual({ date: "2026-10-12", time: "10:00" }); // sábado → segunda (domingo fechado)
    expect(defaultSlot(bahia("2026-10-07T12:00:00"), DEFAULT_HOURS, bahia("2026-10-09T14:30:00"))).toEqual({ date: "2026-10-09", time: "14:30" });
    expect(defaultSlot(bahia("2026-10-07T12:00:00"), DEFAULT_HOURS, bahia("2026-10-06T14:30:00"))).toEqual({ date: "2026-10-08", time: "10:00" }); // marcado no passado: sugere de novo
  });
});
