import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../../db";
import { auditLog, cashSessions, comandaPayments, comandas } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { addMovement, cashSummary, closeCash, openCash } from "./cash";
import { addItem, addPayment, closeComanda, openWalkInComanda, reopenComanda } from "./comandas";

/** Achados da revisão final do branch (Plano 3). */
let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });

async function comanda(cents: number) {
  const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "produto", label: "Kit", unitCents: cents }, s.caixaRecepcao, NOW);
  return w.comandaId;
}
const zeros = { pix: 0, credito: 0, debito: 0, outra: 0 };

describe("aprovação não se burla recontando", () => {
  it("depois de um 'precisa de aprovação', a recontagem também pede aprovação, e a tentativa fica na auditoria", async () => {
    const a = await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    expect(await closeCash({ cashBreakdown: { "5000": 1 }, counted: zeros }, s.caixaRecepcao, NOW)).toMatchObject({ status: "precisa_aprovacao" });
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "caixa_contagem_recusada"));
    expect(log).toMatchObject({ entityId: a.id, data: { contado: expect.objectContaining({ dinheiro: 5000 }), diferenca: -5000 } });
    // Recontou "certinho": mesmo assim pede a gestão.
    expect(await closeCash({ cashBreakdown: { "10000": 1 }, counted: zeros }, s.caixaRecepcao, NOW)).toMatchObject({ status: "precisa_aprovacao" });
    expect(await closeCash({ cashBreakdown: { "10000": 1 }, counted: zeros, approverId: s.gestora.id }, s.caixaRecepcao, NOW)).toMatchObject({ status: "fechado", differenceCents: 0 });
    expect((await db.select().from(cashSessions))[0].approvedBy).toBe(s.gestora.id);
  });
});

describe("contagem cega não vaza pela sangria", () => {
  it("sangria maior que o dinheiro: sem o valor para quem conta às cegas", async () => {
    await setSetting("caixa_regras", { contagemCega: true });
    await openCash({ openingCents: 10000 }, s.caixaRecepcao, NOW);
    await expect(addMovement({ kind: "sangria", valueCents: 50000, reason: "banco" }, s.caixaRecepcao, NOW)).rejects.toThrow(/^Sangria maior que o dinheiro do caixa\.$/);
  });
});

describe("fechar o caixa x receber ao mesmo tempo", () => {
  it("pagamento que espera o fechamento terminar não entra no caixa já fechado", async () => {
    const a = await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda(5000);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from cash_sessions where id = $1 for update", [a.id]); // o fechamento em andamento
      await client.query("update cash_sessions set status = 'fechado' where id = $1", [a.id]);
      const paying = addPayment(c, { method: "pix", valueCents: 5000 }, s.caixaRecepcao, NOW);
      await new Promise((r) => setTimeout(r, 400));
      await client.query("commit");
      await paying;
    } finally { client.release(); }
    const [p] = await db.select().from(comandaPayments).where(eq(comandaPayments.comandaId, c));
    expect(p.cashSessionId).toBeNull();
  });
});

describe("troco e caixa fechado", () => {
  it("não fecha o caixa com comanda paga em dinheiro com troco ainda não finalizada", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda(12000);
    await addPayment(c, { method: "dinheiro", valueCents: 15000 }, s.caixaRecepcao, NOW);
    await expect(closeCash({ cashBreakdown: { "10000": 1, "2000": 1 }, counted: zeros }, s.caixaRecepcao, NOW))
      .rejects.toThrow("A comanda 1 tem troco a devolver: finalize antes de fechar o caixa.");
    await closeComanda(c, {}, s.caixaRecepcao, NOW);
    expect(await closeCash({ cashBreakdown: { "10000": 1, "2000": 1 }, counted: zeros }, s.caixaRecepcao, NOW)).toMatchObject({ status: "fechado", differenceCents: 0 });
  });

  it("o troco não é gravado num caixa já fechado (a gestão reabre esse caixa primeiro)", async () => {
    await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda(12000);
    await addPayment(c, { method: "dinheiro", valueCents: 10000 }, s.caixaRecepcao, NOW); // parcial, sem troco
    await closeCash({ cashBreakdown: { "10000": 1 }, counted: zeros }, s.caixaRecepcao, NOW);
    await db.execute(sql`update comanda_items set unit_cents = 9000 where comanda_id = ${c}`); // agora o dinheiro passa: troco de 10
    await expect(closeComanda(c, {}, s.caixaGestao, NOW)).rejects.toThrow("O troco sairia do caixa de Cati, que já fechou. A gestão reabre esse caixa primeiro.");
  });

  it("reabrir comanda com pagamento de caixa já fechado é recusado (a gestão reabre o caixa antes)", async () => {
    const a = await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
    const c = await comanda(12000);
    await addPayment(c, { method: "dinheiro", valueCents: 15000 }, s.caixaRecepcao, NOW);
    await closeComanda(c, {}, s.caixaRecepcao, NOW);
    await closeCash({ cashBreakdown: { "10000": 1, "2000": 1 }, counted: zeros }, s.caixaRecepcao, NOW);
    const before = (await cashSummary(a.id)).expected.dinheiro;
    await expect(reopenComanda(c, { reason: "erro" }, s.caixaGestao, NOW)).rejects.toThrow("Um pagamento desta comanda entrou no caixa de Cati, que já fechou. A gestão reabre esse caixa primeiro.");
    expect((await cashSummary(a.id)).expected.dinheiro).toBe(before);
    expect((await db.select().from(comandas).where(eq(comandas.id, c)))[0].status).toBe("fechada");
  });
});
