import { it, expect } from "vitest";
import { bahiaAt, dueLabel, nextActionPresets } from "./next-action";

// 2026-10-13 14:00 em Salvador = 17:00 UTC
const NOW = Date.parse("2026-10-13T17:00:00Z");

it("bahiaAt lê o relógio de Salvador, não o de UTC", () => {
  expect(bahiaAt(NOW, 0, 18).toISOString()).toBe("2026-10-13T21:00:00.000Z");
  expect(bahiaAt(NOW, 1, 10).toISOString()).toBe("2026-10-14T13:00:00.000Z");
  // 22h30 de Salvador já é dia seguinte em UTC; "hoje" continua sendo o dia de Salvador
  expect(bahiaAt(Date.parse("2026-10-14T01:30:00Z"), 0, 18).toISOString()).toBe("2026-10-13T21:00:00.000Z");
});

it("atalhos: Hoje 18h, Amanhã 10h, Em 3 dias; depois das 18h o Hoje some", () => {
  expect(nextActionPresets(NOW).map((p) => [p.label, p.at.toISOString()])).toEqual([
    ["Hoje 18h", "2026-10-13T21:00:00.000Z"], ["Amanhã 10h", "2026-10-14T13:00:00.000Z"], ["Em 3 dias", "2026-10-16T13:00:00.000Z"],
  ]);
  const tarde = Date.parse("2026-10-13T22:00:00Z"); // 19h em Salvador
  expect(nextActionPresets(tarde).map((p) => p.label)).toEqual(["Amanhã 10h", "Em 3 dias"]);
});

it("dueLabel diz hoje, amanhã, ontem ou o dia da semana", () => {
  expect(dueLabel(Date.parse("2026-10-13T21:00:00Z"), NOW)).toBe("hoje 18:00");
  expect(dueLabel(Date.parse("2026-10-14T13:00:00Z"), NOW)).toBe("amanhã 10:00");
  expect(dueLabel(Date.parse("2026-10-12T12:00:00Z"), NOW)).toBe("ontem 09:00");
  expect(dueLabel(Date.parse("2026-10-16T13:00:00Z"), NOW)).toBe("sex 16/10 10:00");
});
