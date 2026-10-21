import { describe, expect, it } from "vitest";
import { buildIcs, icsEscape, icsFold, icsUtc } from "./ics";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);

describe("arquivo de calendário (RFC 5545)", () => {
  it("16/10 às 23:30 em Salvador sai como DTSTART:20261017T023000Z (UTC), em qualquer fuso do processo", () => {
    expect(icsUtc(bahia("2026-10-16", "23:30"))).toBe("20261017T023000Z");
    const ics = buildIcs({ uid: "v1@casafiaes", start: bahia("2026-10-16", "23:30"), end: bahia("2026-10-17", "00:30"), summary: "Casa Fiaes · Corte com a Ana",
      location: "Rua A, 10; sala 2", description: `Para confirmar: https://crm.casafiaes.com.br/c/${"x".repeat(43)}`, now: new Date("2026-10-15T15:00:00Z") });
    expect(ics).toContain("\r\nDTSTART:20261017T023000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20261017T033000Z\r\n");
    expect(ics).toContain("\r\nUID:v1@casafiaes\r\n");
    expect(ics).toContain("LOCATION:Rua A\\, 10\\; sala 2");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("texto escapado e linhas de até 75 bytes, sem partir caractere", () => {
    expect(icsEscape("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
    const fold = icsFold(`SUMMARY:${"ã".repeat(60)}`);
    expect(fold.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75)).toBe(true);
    expect(fold.replace(/\r\n /g, "")).toBe(`SUMMARY:${"ã".repeat(60)}`);
  });

  it("sem fim conhecido, não inventa DTEND; sem endereço, sem LOCATION", () => {
    const ics = buildIcs({ uid: "v1@casafiaes", start: bahia("2026-10-16", "10:00"), end: null, summary: "Casa Fiaes · Corte", location: null, description: "x", now: new Date("2026-10-15T15:00:00Z") });
    expect(ics).not.toContain("DTEND");
    expect(ics).not.toContain("LOCATION");
  });
});
