import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { item, payment } from "../../../test/salon-fixtures";
import type { Perm } from "@/lib/permissions";
import { salonFinance } from "./salon";
import { loadAnalysis } from "./screen";

const NOW = new Date("2026-10-15T15:00:00Z");
beforeEach(resetDb);

it("Financeiro: o salão no período da tela (comandas do Avec e do CRM, recebido por forma) e até quando vai o Avec", async () => {
  await item({ day: "2026-10-02", value: 50000 });
  await item({ day: "2026-10-03", value: 7000, origin: "crm" }); // comanda do CRM (Lote 6C) entra junto
  await item({ day: "2026-09-30", value: 99000 });                // fora do mês
  await payment({ day: "2026-10-02", value: 40000, method: "Pix" });
  expect(await salonFinance({ period: "mes", now: NOW })).toEqual({
    from: "2026-10-01", to: "2026-10-15", avecUntil: "2026-10-02", faturadoCents: 57000, comandas: 2, recebidoCents: 40000,
    byMethod: [{ method: "Pix", n: 1, cents: 40000 }],
  });
});

it("Análise: o bloco do salão só vai para quem vê a equipe e os valores", async () => {
  const u = { id: "00000000-0000-4000-8000-000000000001", name: "Teste", email: "t@t.local" };
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver", "relatorios.equipe"] as Perm[] }, { period: "mes", now: NOW })).salon).toBeNull();
  expect((await loadAnalysis({ ...u, perms: ["relatorios.ver", "relatorios.equipe", "valores.ver"] as Perm[] }, { period: "mes", now: NOW })).salon).not.toBeNull();
});
