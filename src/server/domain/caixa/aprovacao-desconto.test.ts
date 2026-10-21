import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, comandaItems } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { addItem, addPayment, ApprovalNeededError, openWalkInComanda, setComandaDiscount, updateItem } from "./comandas";
import { getCaixaRules, saveCaixaRules } from "./mode";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });

/** Comanda avulsa com um Corte (R$ 120, preço de tabela) da Ana. */
async function corte() {
  const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  const it = await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
  return { comandaId: w.comandaId, itemId: it.id };
}
const limite = (bp: number | null) => saveCaixaRules({ toleranciaCents: 500, contagemCega: true, sangriaGrandeCents: 20000, aprovacaoDescontoBp: bp }, s.gestora.id);
const audit = async (action: string) => (await db.select().from(auditLog).where(eq(auditLog.action, action))).map((a) => a.data);

describe("cortesia e desconto acima do limite (QA r58, I-11)", () => {
  it("vem desligado: todos dão desconto e cortesia com motivo, sem a gestão (decisão do dono)", async () => {
    expect((await getCaixaRules()).aprovacaoDescontoBp).toBeNull();
    const c = await corte();
    await updateItem(c.itemId, { discountPercent: 50, reason: "promoção" }, s.caixaRecepcao, NOW);
    await addPayment(c.comandaId, { method: "cortesia", valueCents: 6000, note: "aniversário" }, s.caixaRecepcao, NOW);
  });

  it("ligado em 20%: desconto no item, preço abaixo da tabela, desconto na comanda e cortesia acima disso pedem a gestão", async () => {
    await limite(2000);
    const c = await corte();
    await expect(updateItem(c.itemId, { discountPercent: 30, reason: "promoção" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto e cortesia somam 30% da comanda, acima do limite de 20%: a gestão aprova.");
    await expect(updateItem(c.itemId, { discountPercent: 30, reason: "promoção" }, s.caixaRecepcao, NOW)).rejects.toBeInstanceOf(ApprovalNeededError);
    await updateItem(c.itemId, { discountPercent: 10, reason: "primeira vez" }, s.caixaRecepcao, NOW); // dentro do limite
    await expect(updateItem(c.itemId, { unitCents: 6000, discountCents: 0, reason: "amiga da dona" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto e cortesia somam 50% da comanda, acima do limite de 20%: a gestão aprova.");
    await expect(setComandaDiscount(c.comandaId, { percent: 25, reason: "pacote" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto e cortesia somam 32,5% da comanda, acima do limite de 20%: a gestão aprova.");
    await expect(addPayment(c.comandaId, { method: "cortesia", valueCents: 10800, note: "retoque" }, s.caixaRecepcao, NOW)).rejects.toThrow("Desconto e cortesia somam 100% da comanda, acima do limite de 20%: a gestão aprova.");
    // A gestão também passa pela aprovação (um clique na tela, como no fechamento); quem não é gestão não aprova.
    await expect(addPayment(c.comandaId, { method: "cortesia", valueCents: 10800, note: "retoque" }, s.caixaGestao, NOW)).rejects.toBeInstanceOf(ApprovalNeededError);
    await expect(addPayment(c.comandaId, { method: "cortesia", valueCents: 10800, note: "retoque", approverId: s.cati.id }, s.caixaRecepcao, NOW)).rejects.toBeInstanceOf(ApprovalNeededError);
    await addPayment(c.comandaId, { method: "cortesia", valueCents: 10800, note: "retoque", approverId: s.gestora.id }, s.caixaRecepcao, NOW);
    expect(await audit("cortesia")).toEqual([expect.objectContaining({ valor: 10800, motivo: "retoque", aprovadoPor: s.gestora.id })]);
  });

  it("com a aprovação da gestão, o desconto e o preço entram e a auditoria guarda quem aprovou", async () => {
    await limite(2000);
    const c = await corte();
    await updateItem(c.itemId, { unitCents: 6000, reason: "amiga da dona", approverId: s.gestora.id }, s.caixaRecepcao, NOW);
    expect((await db.select().from(comandaItems).where(eq(comandaItems.id, c.itemId)))[0].unitCents).toBe(6000);
    expect(await audit("preco_alterado")).toEqual([expect.objectContaining({ de: 12000, para: 6000, aprovadoPor: s.gestora.id })]);
    await setComandaDiscount(c.comandaId, { percent: 50, reason: "pacote", approverId: s.gestora.id }, s.caixaRecepcao, NOW);
    expect(await audit("desconto")).toEqual([expect.objectContaining({ valor: 3000, aprovadoPor: s.gestora.id })]);
  });

  it("o limite vale para a soma (revisão): 19% no item, 19% na comanda e 19% de cortesia não passam sem a gestão", async () => {
    await limite(2000);
    const c = await corte();
    await updateItem(c.itemId, { discountPercent: 19, reason: "promoção" }, s.caixaRecepcao, NOW); // 2.280 de 12.000
    await expect(setComandaDiscount(c.comandaId, { percent: 19, reason: "pacote" }, s.caixaRecepcao, NOW)).rejects.toBeInstanceOf(ApprovalNeededError);
    await expect(addPayment(c.comandaId, { method: "cortesia", valueCents: 2000, note: "retoque" }, s.caixaRecepcao, NOW)).rejects.toBeInstanceOf(ApprovalNeededError);
    await addPayment(c.comandaId, { method: "pix", valueCents: 2000 }, s.caixaRecepcao, NOW); // pagar não é abatimento
  });

  it("a regra fica em Caixas da equipe: de 1% a 100%, ou desligada", async () => {
    await limite(1500);
    expect((await getCaixaRules()).aprovacaoDescontoBp).toBe(1500);
    await expect(limite(0)).rejects.toThrow("Use de 1% a 100%.");
    await limite(null);
    expect((await getCaixaRules()).aprovacaoDescontoBp).toBeNull();
  });
});
