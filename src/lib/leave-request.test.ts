import { describe, expect, it } from "vitest";
import { periodLabel, validateLeave } from "./leave-request";

const base = { startsOn: "2026-10-20", endsOn: "2026-10-20", allDay: true, startTime: "", endTime: "", reason: "folga", note: "" };

describe("pedido de folga (mesmas regras do bloqueio, seção 5.5)", () => {
  it("dia todo vira 00:00–24:00 com o motivo como título", () => {
    expect(validateLeave(base, "2026-10-16")).toEqual({ ok: true, row: { startsOn: "2026-10-20", endsOn: "2026-10-20", startTime: "00:00", endTime: "24:00", reason: "folga", title: "Folga", notes: null } });
  });
  it("recusa: dia no passado, fim antes do início, mais de 366 dias, hora final antes da inicial, motivo vazio e 'Outro' sem texto", () => {
    expect(validateLeave({ ...base, startsOn: "2026-10-15", endsOn: "2026-10-15" }, "2026-10-16")).toEqual({ ok: false, error: "Escolha um dia de hoje em diante." });
    expect(validateLeave({ ...base, endsOn: "2026-10-19" }, "2026-10-16")).toEqual({ ok: false, error: "A data final não pode vir antes da inicial." });
    expect(validateLeave({ ...base, endsOn: "2027-10-22" }, "2026-10-16")).toEqual({ ok: false, error: "O período passa de 366 dias." });
    expect(validateLeave({ ...base, allDay: false, startTime: "18:00", endTime: "14:00", reason: "curso" }, "2026-10-16")).toEqual({ ok: false, error: "A hora final precisa ser depois da inicial." });
    expect(validateLeave({ ...base, reason: "x" }, "2026-10-16")).toEqual({ ok: false, error: "Escolha o motivo." });
    expect(validateLeave({ ...base, reason: "outro", note: " " }, "2026-10-16")).toEqual({ ok: false, error: "Escreva o motivo." });
  });
  it("texto do período", () => {
    expect(periodLabel({ startsOn: "2026-10-20", endsOn: "2026-10-20", startTime: "00:00", endTime: "24:00" })).toBe("20/10 (dia todo)");
    expect(periodLabel({ startsOn: "2026-10-20", endsOn: "2026-10-22", startTime: "00:00", endTime: "24:00" })).toBe("20/10 a 22/10 (dia todo)");
    expect(periodLabel({ startsOn: "2026-10-20", endsOn: "2026-10-20", startTime: "14:00", endTime: "18:00" })).toBe("20/10, das 14:00 às 18:00");
  });
});
