import { describe, expect, it } from "vitest";
import { applyLateTitle, lateAnnouncement, lateTitle, quietUntilLabel } from "./late";

describe("lateTitle", () => {
  it("troca o título quando há atrasados e devolve o original quando zera", () => {
    expect(lateTitle(2, "Hoje · Casa Fiaes")).toBe("(2) atrasados · Casa Fiaes");
    expect(lateTitle(0, "Hoje · Casa Fiaes")).toBe("Hoje · Casa Fiaes");
  });
});

describe("lateAnnouncement", () => {
  it("singular e plural", () => {
    expect(lateAnnouncement(1)).toBe("1 lead atrasado");
    expect(lateAnnouncement(4)).toBe("4 leads atrasados");
    expect(lateAnnouncement(0)).toBe("");
  });
});

describe("applyLateTitle (título da aba)", () => {
  it("2 -> 1 -> 0 volta ao título original (não captura o próprio título)", () => {
    let doc = "Hoje · Casa Fiaes";
    let original = "";
    const step = (n: number) => { const r = applyLateTitle(doc, n, original); doc = r.title; original = r.original; return doc; };
    expect(step(2)).toBe("(2) atrasados · Casa Fiaes");
    expect(step(1)).toBe("(1) atrasados · Casa Fiaes");
    expect(step(0)).toBe("Hoje · Casa Fiaes");
  });
  it("o Next trocou o título numa navegação: o novo original é capturado", () => {
    const r = applyLateTitle("Funil · Casa Fiaes", 2, "Hoje · Casa Fiaes");
    expect(r).toEqual({ title: "(2) atrasados · Casa Fiaes", original: "Funil · Casa Fiaes" });
  });
  it("sem atrasados e título normal: não mexe", () => {
    expect(applyLateTitle("Hoje", 0, "")).toEqual({ title: "Hoje", original: "Hoje" });
  });
});

describe("quietUntilLabel (dia no fuso America/Bahia)", () => {
  const now = new Date("2026-10-10T15:00:00Z"); // sáb 12:00 em Salvador
  it("hoje", () => { expect(quietUntilLabel(new Date("2026-10-10T18:28:00Z"), now)).toBe("até 15:28"); });
  it("amanhã", () => { expect(quietUntilLabel(new Date("2026-10-11T06:28:00Z"), now)).toBe("até amanhã 03:28"); });
  it("depois: dia da semana", () => { expect(quietUntilLabel(new Date("2026-10-12T06:28:00Z"), now)).toBe("até seg 03:28"); });
  it("a virada do dia usa o fuso da Bahia, não UTC", () => {
    // 01:30Z do dia 11 ainda é 22:30 do dia 10 em Salvador: hoje.
    expect(quietUntilLabel(new Date("2026-10-11T01:30:00Z"), now)).toBe("até 22:30");
  });
});
