import { expect, it } from "vitest";
import { inHouseVisits } from "./na-casa";

const bahia = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m));
const NOW = bahia(15, 11);
const a = (id: string, status: string, h: number, visitId: string | null = null, day = 15) => ({ id, status, startsAt: bahia(day, h), visitId });

it("Chegou ou Em atendimento hoje: a visita está na Casa", () => {
  expect(inHouseVisits([a("1", "chegou", 10)], NOW).map((v) => v.map((x) => x.id))).toEqual([["1"]]);
  expect(inHouseVisits([a("2", "em_atendimento", 11)], NOW)).toHaveLength(1);
});

it("visita com 2 serviços: um finalizado e outro por fazer continua na Casa; os dois finalizados, não", () => {
  expect(inHouseVisits([a("1", "compareceu", 10, "v"), a("2", "agendado", 11, "v")], NOW).map((v) => v.map((x) => x.id))).toEqual([["1", "2"]]);
  expect(inHouseVisits([a("1", "compareceu", 10, "v"), a("2", "compareceu", 11, "v")], NOW)).toEqual([]);
});

it("finalizado sozinho, só agendado, cancelado, de outro dia ou de outra visita: não está na Casa", () => {
  expect(inHouseVisits([a("1", "compareceu", 10)], NOW)).toEqual([]);
  expect(inHouseVisits([a("1", "agendado", 14)], NOW)).toEqual([]);
  expect(inHouseVisits([a("1", "cancelado", 10, "v"), a("2", "agendado", 11, "v")], NOW)).toEqual([]);
  expect(inHouseVisits([a("1", "chegou", 10, null, 14)], NOW)).toEqual([]);
  expect(inHouseVisits([a("1", "compareceu", 9, "v1"), a("2", "agendado", 15, "v2")], NOW)).toEqual([]);
});
