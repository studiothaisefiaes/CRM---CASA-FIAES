import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { appt, client, item } from "../../../test/salon-fixtures";
import type { Perm } from "@/lib/permissions";
import { returnCohorts } from "./cohort";
import { loadAnalysis } from "./screen";

const NOW = new Date("2026-10-15T15:00:00Z");
beforeEach(resetDb);

it("coorte: clientes da primeira visita de cada mês e quantas voltaram em 30, 60 e 90 dias, só quando já deu tempo de medir", async () => {
  const a = await client("A Teste", "+5571990000011"), b = await client("B Teste", "+5571990000012");
  const c = await client("C Teste", "+5571990000013"), e = await client("E Teste", "+5571990000014");
  await item({ day: "2026-06-05", contactId: a, value: 1000 });
  await appt({ day: "2026-06-25", status: "compareceu", contactId: a });   // A volta em 20 dias (horário com Compareceu vale visita)
  await item({ day: "2026-06-10", contactId: b, value: 1000 });
  await item({ day: "2026-08-24", contactId: b, value: 1000 });            // B volta em 75 dias
  await item({ day: "2026-06-12", contactId: c, value: 1000 });            // C não volta
  await item({ day: "2026-09-25", contactId: e, value: 1000 });            // E: ainda não deu 30 dias até a última visita dos dados
  await item({ day: "2026-10-10", contactId: a, value: 1000 });            // a última visita registrada: 10/10
  const r = await returnCohorts(NOW);
  expect(r.dataEnd).toBe("2026-10-10");
  expect(r.rows.map((x) => x.month)).toEqual(["2026-09", "2026-06"]);
  expect(r.rows[1]).toEqual({ month: "2026-06", novas: 3, d30: { base: 3, voltou: 1 }, d60: { base: 3, voltou: 1 }, d90: { base: 3, voltou: 2 } });
  expect(r.rows[0]).toEqual({ month: "2026-09", novas: 1, d30: { base: 0, voltou: 0 }, d60: { base: 0, voltou: 0 }, d90: { base: 0, voltou: 0 } });
});

it("sem dados do Avec: nenhuma linha e nenhuma data", async () => {
  expect(await returnCohorts(NOW)).toEqual({ dataEnd: null, rows: [] });
});

it("na Análise, a coorte só vai para quem vê a equipe (é número do salão inteiro)", async () => {
  const u = { id: "00000000-0000-4000-8000-000000000001", name: "Teste", email: "t@t.local" };
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver"] as Perm[] }, { period: "mes", now: NOW })).cohort).toBeNull();
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver", "relatorios.equipe"] as Perm[] }, { period: "mes", now: NOW })).cohort).toEqual({ dataEnd: null, rows: [] });
});
