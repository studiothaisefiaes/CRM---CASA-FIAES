import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { item, payment, pro } from "../../../test/salon-fixtures";
import { salonRange } from "../../lib/salon-period";
import { loadSalon } from "./salon";

const NOW = new Date("2026-10-15T15:00:00Z");
const SET = salonRange({ periodo: "mes-passado" }, NOW);

beforeEach(resetDb);

/** Todos os valores das chaves que terminam em "cents", em qualquer profundidade do objeto. */
const centsValues = (o: unknown): unknown[] => (Array.isArray(o) ? o.flatMap(centsValues)
  : o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (/cents$/i.test(k) ? [v] : centsValues(v))) : []);

it("sem valores.ver o Salão chega sem nenhum valor (só quantidades) e em ordem de quantidade", async () => {
  const maiara = await pro("MAIARA"), jo = await pro("JO");
  await item({ day: "2026-09-02", comanda: "1", proId: maiara, value: 90000, commissionCents: 1000 });
  await item({ day: "2026-09-03", comanda: "2", proId: jo, value: 1000 });
  await item({ day: "2026-09-04", comanda: "3", proId: jo, value: 1000 });
  await payment({ day: "2026-09-02", value: 90000 });

  const semValores = await loadSalon({ perms: ["relatorios.ver", "relatorios.equipe"] }, SET, NOW);
  expect(semValores.money).toBe(false);
  const all = centsValues(semValores);
  expect(all.length).toBeGreaterThan(10);
  expect(all.every((v) => v === null)).toBe(true);
  expect(semValores.revenue.comandas).toBe(3);
  expect(semValores.professionals.map((p) => p.name)).toEqual(["JO", "MAIARA"]); // por comandas: a ordem não entrega quem fatura mais

  const comValores = await loadSalon({ perms: ["relatorios.ver", "relatorios.equipe", "valores.ver"] }, SET, NOW);
  expect(comValores.revenue.cents).toBe(92000);
  expect(comValores.professionals.map((p) => [p.name, p.commissionCents])).toEqual([["MAIARA", 1000], ["JO", null]]);
});
