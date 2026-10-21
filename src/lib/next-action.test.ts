import { it, expect } from "vitest";
import { bahiaAt, dueLabel, nextActionPresets } from "./next-action";
import type { BusinessHours } from "./business-hours";

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

it("Retomar depois: amanhã, 3 dias, 1 semana e 1 mês, sempre às 10h de Salvador", async () => {
  const { resumePresets } = await import("./next-action");
  const now = Date.parse("2026-10-14T15:44:00Z"); // quarta 12h44
  expect(resumePresets(now).map((p) => [p.key, p.label, p.at.toISOString()])).toEqual([
    ["amanha", "Amanhã", "2026-10-15T13:00:00.000Z"],
    ["3dias", "Em 3 dias", "2026-10-17T13:00:00.000Z"],
    ["semana", "Em 1 semana", "2026-10-21T13:00:00.000Z"],
    ["mes", "Em 1 mês", "2026-11-13T13:00:00.000Z"],
  ]);
});

it("atalhos de data pulam os dias com a Casa fechada (Em 3 dias na qui 15/10 cai na ter 20/10)", async () => {
  const { resumePresets } = await import("./next-action");
  const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
  const qui = Date.parse("2026-10-15T12:00:00Z"); // qui 15/10 9h em Salvador
  const tres = (p: { key: string; at: Date }[]) => p.find((x) => x.key === "3dias")!.at.toISOString();
  expect(tres(resumePresets(qui, CASA))).toBe("2026-10-20T13:00:00.000Z");
  expect(tres(nextActionPresets(qui, CASA))).toBe("2026-10-20T13:00:00.000Z");
  const sab = Date.parse("2026-10-17T12:00:00Z");
  expect(resumePresets(sab, CASA)[0].at.toISOString()).toBe("2026-10-20T13:00:00.000Z");
  expect(nextActionPresets(sab, CASA).find((p) => p.key === "amanha")!.at.toISOString()).toBe("2026-10-20T13:00:00.000Z");
  // sem horário informado continua como antes
  expect(tres(resumePresets(qui))).toBe("2026-10-18T13:00:00.000Z");
});

it("combinado vencido em que a Casa já escreveu depois: sugere marcar como feito", async () => {
  const { answeredAfterDue } = await import("./next-action");
  const due = Date.parse("2026-10-13T13:00:00Z");
  expect(answeredAfterDue(due, Date.parse("2026-10-13T15:00:00Z"), NOW)).toBe(true);
  expect(answeredAfterDue(due, Date.parse("2026-10-13T12:00:00Z"), NOW)).toBe(false); // escreveu antes de vencer
  expect(answeredAfterDue(due, null, NOW)).toBe(false);
  expect(answeredAfterDue(NOW + 3_600_000, NOW, NOW)).toBe(false); // ainda não venceu
});

it("dayWord: hoje, amanhã, dia da semana até 6 dias, senão a data", async () => {
  const { dayWord } = await import("./next-action");
  expect(dayWord(Date.parse("2026-10-13T20:00:00Z"), NOW)).toBe("hoje");
  expect(dayWord(Date.parse("2026-10-14T13:00:00Z"), NOW)).toBe("amanhã");
  expect(dayWord(Date.parse("2026-10-16T13:00:00Z"), NOW)).toBe("sex");
  expect(dayWord(Date.parse("2026-10-21T13:00:00Z"), NOW)).toBe("21/10");
});

it("retomarPresets: Hoje 15:00 (se ainda dá), Amanhã 10:00 e Sáb 09:00, pulando dia fechado", async () => {
  const { retomarPresets } = await import("./next-action");
  const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
  const manha = Date.parse("2026-10-13T12:00:00Z"); // terça 09h
  expect(retomarPresets(manha, CASA).map((p) => [p.label, p.at.toISOString()])).toEqual([
    ["Hoje 15:00", "2026-10-13T18:00:00.000Z"], ["Amanhã 10:00", "2026-10-14T13:00:00.000Z"], ["Sáb 09:00", "2026-10-17T12:00:00.000Z"],
  ]);
  // terça 16h: "Hoje 15:00" já passou
  expect(retomarPresets(Date.parse("2026-10-13T19:00:00Z"), CASA).map((p) => p.key)).toEqual(["amanha", "sabado"]);
  // sábado: amanhã (domingo) e segunda fechados → "Ter 10:00"; o sábado seguinte entra como 3º
  expect(retomarPresets(Date.parse("2026-10-17T19:00:00Z"), CASA).map((p) => [p.label, p.at.toISOString()])).toEqual([
    ["Ter 10:00", "2026-10-20T13:00:00.000Z"], ["Sáb 09:00", "2026-10-24T12:00:00.000Z"],
  ]);
  // sexta: o sábado é o amanhã → o 3º vira "Em 3 dias"
  expect(retomarPresets(Date.parse("2026-10-16T19:00:00Z"), CASA).map((p) => p.key)).toEqual(["amanha", "3dias"]);
});
