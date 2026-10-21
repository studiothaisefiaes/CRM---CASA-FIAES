import { describe, expect, it } from "vitest";
import { urgencyOf } from "./timer";
import { slaLevel } from "@/lib/queue";
import { businessSecondsBetween, type BusinessHours } from "@/lib/business-hours";

const allDay: [string, string] = ["00:00", "24:00"];
const H: BusinessHours = { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay };
/** Horário da Casa (Lote 0): terça a sábado, 9h às 18h. */
const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const now = Date.parse("2026-10-15T17:00:00Z");
const ago = (s: number) => new Date(now - s * 1000).toISOString();

describe("urgencyOf: a mesma regra da Fila (cabeçalho, Quadro, WhyLate)", () => {
  it("dourado a partir de 60% do prazo, nunca antes", () => {
    expect(urgencyOf(ago(8 * 60), 15, now, H)).toBe("ok"); // 53%
    expect(urgencyOf(ago(9 * 60), 15, now, H)).toBe("warn"); // 60%
  });
  it("vermelho só com alerta aberto; passou do prazo sem alerta continua dourado", () => {
    expect(urgencyOf(ago(20 * 60), 15, now, H)).toBe("warn");
    expect(urgencyOf(ago(20 * 60), 15, now, H, true)).toBe("late");
    expect(urgencyOf(null, 15, now, H, true)).toBe("late");
  });
  it("espera que atravessa dias fechados conta só o expediente (sábado 17:55 → terça 9:02 = 7 min de 15)", () => {
    const sabado = "2026-10-17T20:55:00Z"; // sábado 17:55 em Salvador
    const terca = Date.parse("2026-10-20T12:02:00Z"); // terça 9:02 (domingo e segunda fechados)
    expect(businessSecondsBetween(Date.parse(sabado), terca, CASA)).toBe(7 * 60);
    expect(urgencyOf(sabado, 15, terca, CASA)).toBe("ok");
    expect(slaLevel({ awaiting: true, alert: false, waitSeconds: businessSecondsBetween(Date.parse(sabado), terca, CASA), slaMinutes: 15 })).toBe("ok");
  });
});
