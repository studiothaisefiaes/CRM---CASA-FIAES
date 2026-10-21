import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { loyaltyEntries, loyaltyPrograms } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { cliente, NOW } from "../../../test/agenda-fixtures";
import { saveFuncoes } from "../domain/funcoes";
import { getComandaDetail } from "./caixa";
import { getLoyaltyOverview, getLoyaltyView } from "./loyalty-view";
import { openWalkInComanda } from "../domain/caixa/comandas";
import { randomUUID } from "node:crypto";

let s: Awaited<ReturnType<typeof setupCaixa>>, fiel: string;
beforeEach(async () => {
  await resetDb();
  s = await setupCaixa();
  [{ id: fiel }] = await db.insert(loyaltyPrograms).values({ name: "Fiel da Fiaes", kind: "contagem", goal: 12 }).returning();
});

describe("fidelidade nas telas", () => {
  it("a ficha recebe a situação em cada programa e o histórico (mais novo primeiro)", async () => {
    const p = await cliente("Ana Teste");
    await db.insert(loyaltyEntries).values([
      { contactId: p.contactId, programId: fiel, delta: 9, reason: "saldo_avec", externalKey: `avec:fid:${p.contactId}`, createdAt: new Date("2026-10-01T10:00:00Z") },
      { contactId: p.contactId, programId: fiel, delta: 1, reason: "ajuste", note: "Cortesia", createdAt: new Date("2026-10-05T10:00:00Z") },
    ]);
    const v = await getLoyaltyView(p.contactId, NOW);
    expect(v.programs).toMatchObject([{ name: "Fiel da Fiaes", balance: 10, goal: 12, ready: false }]);
    expect(v.history.map((h) => [h.reason, h.delta, h.programName, h.note])).toEqual([["ajuste", 1, "Fiel da Fiaes", "Cortesia"], ["saldo_avec", 9, "Fiel da Fiaes", null]]);
  });

  it("o detalhe da comanda aberta traz a fidelidade da cliente; com a função desligada ou sem cliente não traz", async () => {
    const p = await cliente("Ana Teste");
    await db.insert(loyaltyEntries).values({ contactId: p.contactId, programId: fiel, delta: 12, reason: "ajuste" });
    const { comandaId } = await openWalkInComanda({ contactId: p.contactId, requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    expect((await getComandaDetail(comandaId, s.gestora.id))?.loyalty).toMatchObject([{ name: "Fiel da Fiaes", balance: 12, ready: true }]);
    const { comandaId: sem } = await openWalkInComanda({ contactId: null, requestKey: randomUUID() }, s.caixaRecepcao, NOW);
    expect((await getComandaDetail(sem, s.gestora.id))?.loyalty).toBeUndefined();
    await saveFuncoes({ fidelidade: false }, s.gestora.id);
    expect((await getComandaDetail(comandaId, s.gestora.id))?.loyalty).toBeUndefined();
  });

  it("Clientes › Fidelidade: o saldo de cada cliente por programa (maior primeiro, sem saldo zerado) e os últimos movimentos com o nome", async () => {
    const a = await cliente("Ana Teste"), b = await cliente("Bia Teste"), c = await cliente("Cris Teste");
    await db.insert(loyaltyEntries).values([
      { contactId: a.contactId, programId: fiel, delta: 4, reason: "servico", createdAt: new Date("2026-10-01T10:00:00Z") },
      { contactId: a.contactId, programId: fiel, delta: 3, reason: "servico", createdAt: new Date("2026-10-02T10:00:00Z") },
      { contactId: b.contactId, programId: fiel, delta: 9, reason: "saldo_avec", externalKey: `avec:fid:${b.contactId}`, createdAt: new Date("2026-10-03T10:00:00Z") },
      { contactId: c.contactId, programId: fiel, delta: 12, reason: "servico", createdAt: new Date("2026-10-04T10:00:00Z") },
      { contactId: c.contactId, programId: fiel, delta: -12, reason: "resgate", createdAt: new Date("2026-10-05T10:00:00Z") },
    ]);
    const o = await getLoyaltyOverview();
    expect(o.balances.map((r) => [r.name, r.programName, r.balance])).toEqual([["Bia Teste", "Fiel da Fiaes", 9], ["Ana Teste", "Fiel da Fiaes", 7]]);
    expect(o.movements.map((m) => [m.name, m.reason, m.delta])).toEqual([["Cris Teste", "resgate", -12], ["Cris Teste", "servico", 12], ["Bia Teste", "saldo_avec", 9], ["Ana Teste", "servico", 3], ["Ana Teste", "servico", 4]]);
  });
});
