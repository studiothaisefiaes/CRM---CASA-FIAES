import { describe, it, expect, beforeEach } from "vitest";
import { permsFor } from "../../../test/perms";
import { db } from "../db";
import { users } from "../db/schema";
import { recordInbound, recordOutbound, moveDealTx } from "../domain/deals";
import { deals } from "../db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)
import { loadAnalysis, loadOverview, scopedFilter } from "./screen";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 13, h + 3, m));

describe("dados da tela de relatórios", () => {
  let gestor: typeof users.$inferSelect, ana: typeof users.$inferSelect, bia: typeof users.$inferSelect;
  beforeEach(async () => {
    await resetDb(); await etapasAntigasAtivas();
    [gestor, ana, bia] = await db.insert(users).values([
      { name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" },
      { name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" },
      { name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" },
    ]).returning();
    for (const [i, owner] of [[1, ana], [2, bia]] as const) {
      const r = await recordInbound({ channelId: null, externalId: `S${i}`, phoneRaw: `7199988000${i}`, body: "oi", at: T(9, i) });
      if (!("dealId" in r)) throw new Error();
      await db.update(deals).set({ ownerId: owner.id, valueCents: 50_000 * i, paymentMethod: "pix" }).where(eq(deals.id, r.dealId));
      await recordOutbound({ dealId: r.dealId, channelId: null, body: "a", userId: owner.id, at: T(9, i + 1) });
      await db.transaction((tx) => moveDealTx(tx, r.dealId, "fechado", null, "venda", T(10)));
    }
  });

  it("atendente: só os leads dela e nenhum valor em R$ nem dados de gestão", async () => {
    const u = { id: ana.id, perms: permsFor("atendente"), name: "Ana", email: "a@c.com" };
    const o = await loadOverview(u, { period: "hoje", now: T(18), ownerId: bia.id }); // tentar ver a Bia é ignorado
    expect(o.numbers.leadsNovos.atual).toBe(1);
    expect(o.numbers.vendas.atual).toEqual({ n: 1, cents: null });
    expect(o.numbers.ticketMedio).toBeNull();
    expect(o.sources.every((s) => s.receitaCents === null)).toBe(true);
    expect(JSON.stringify(o)).not.toMatch(/R\$|50000|100000/);
    expect(o.quality.checks.find((c) => c.key === "semOrigem")!.of).toBe(1); // a qualidade dos dados também é só dos leads dela
    const a = await loadAnalysis(u, { period: "hoje", now: T(18) });
    expect(a.people).toBeNull(); expect(a.finance).toBeNull();
  });

  it("gestão vê tudo: valores, pessoas e financeiro", async () => {
    const u = { id: gestor.id, perms: permsFor("gestor"), name: "G", email: "g@c.com" };
    const o = await loadOverview(u, { period: "hoje", now: T(18) });
    expect(o.numbers.leadsNovos.atual).toBe(2);
    expect(o.numbers.vendas.atual).toEqual({ n: 2, cents: 150_000 });
    expect(o.numbers.ticketMedio).toMatchObject({ atual: 75_000, n: 2 });
    const a = await loadAnalysis(u, { period: "hoje", now: T(18) });
    expect(a.people).toEqual([]); // 2 respostas: abaixo de n = 20, sem pessoa
    expect(a.finance!.totalCents).toBe(150_000);
  });

  it("links do resumo apontam só para filtros que a Fila entende", async () => {
    const u = { id: gestor.id, perms: permsFor("gestor"), name: "G", email: "g@c.com" };
    const o = await loadOverview(u, { period: "hoje", now: T(18) });
    expect(o.summary.links.every((l) => l.href.startsWith("/atendimento?filtro=") && !/cobrancas/.test(l.href))).toBe(true);
  });

  it("scopedFilter: gestão filtra por pessoa, atendente é travada nela mesma", () => {
    expect(scopedFilter({ id: "a", perms: permsFor("atendente"), name: "", email: "" }, { period: "mes", ownerId: "b" }).ownerId).toBe("a");
    expect(scopedFilter({ id: "g", perms: permsFor("gestor"), name: "", email: "" }, { period: "mes", ownerId: "b" }).ownerId).toBe("b");
    expect(scopedFilter({ id: "g", perms: permsFor("gestor"), name: "", email: "" }, { period: "mes" }).compare).toBe(true);
  });
});
