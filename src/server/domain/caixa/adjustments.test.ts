import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, professionalAdjustments } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { CAIXA_RECURSOS_PADRAO } from "@/lib/caixa-recursos";
import { addAdjustment, ADJUSTMENT_LABEL, cancelAdjustment, listAdjustments, materializeRulesTx, saveAdjustmentRule } from "./adjustments";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const RULE = (o = {}) => ({ professionalId: s.ana.id, kind: "bonus" as const, valueCents: 10000, dayOfMonth: 5, startsOn: "2026-08-01", note: "Meta de pacotes", active: true, ...o });

describe("vale, bônus e desconto na comissão", () => {
  it("os nomes de tela", () => {
    expect(ADJUSTMENT_LABEL).toEqual({ vale: "Vale", bonus: "Bônus", desconto: "Desconto na comissão" });
  });

  it("motivo obrigatório; regra 'todo mês no dia 5' cria um por mês, uma vez só", async () => {
    await expect(addAdjustment({ professionalId: s.ana.id, kind: "vale", valueCents: 5000, day: "2026-10-10", note: " " }, s.caixaGestao)).rejects.toThrow("Escreva o motivo.");
    await saveAdjustmentRule(RULE(), s.caixaGestao);
    expect(await db.transaction((tx) => materializeRulesTx(tx, "2026-10-18"))).toBe(3);
    expect(await db.transaction((tx) => materializeRulesTx(tx, "2026-10-18"))).toBe(0);
    expect((await db.select().from(professionalAdjustments)).map((a) => a.day).sort()).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
  });

  it("a regra respeita início, fim, dia 1 a 28 e o pausar; para uma profissional só quando pedido", async () => {
    await expect(saveAdjustmentRule(RULE({ dayOfMonth: 29 }), s.caixaGestao)).rejects.toThrow("Use um dia de 1 a 28.");
    await expect(saveAdjustmentRule(RULE({ endsOn: "2026-07-01" }), s.caixaGestao)).rejects.toThrow("O fim não pode ser antes do início.");
    await saveAdjustmentRule(RULE({ endsOn: "2026-09-30" }), s.caixaGestao);
    await saveAdjustmentRule(RULE({ professionalId: s.bia.id, kind: "desconto", startsOn: "2026-10-01", note: "Aluguel da cadeira" }), s.caixaGestao);
    await saveAdjustmentRule(RULE({ professionalId: s.bia.id, kind: "vale", active: false }), s.caixaGestao);
    expect(await db.transaction((tx) => materializeRulesTx(tx, "2026-10-18", s.ana.id))).toBe(2);
    expect(await db.transaction((tx) => materializeRulesTx(tx, "2026-10-18"))).toBe(1);
    const rows = await db.select().from(professionalAdjustments);
    expect(rows.filter((r) => r.professionalId === s.bia.id).map((r) => [r.kind, r.day])).toEqual([["desconto", "2026-10-05"]]);
  });

  it("editar a regra grava de/para; lançar grava quem, depois e motivo; cancelar grava o motivo", async () => {
    const { id } = await saveAdjustmentRule(RULE(), s.caixaGestao);
    await saveAdjustmentRule(RULE({ id, valueCents: 12000 }), s.caixaGestao);
    const a = await db.select().from(auditLog).where(eq(auditLog.action, "ajuste_regra"));
    expect(a).toHaveLength(2);
    expect(a.find((x) => (x.data as { antes: unknown }).antes)!.data).toMatchObject({ antes: { valueCents: 10000 }, depois: { valueCents: 12000 }, motivo: "Meta de pacotes" });
    const add = await addAdjustment({ professionalId: s.ana.id, kind: "vale", valueCents: 5000, day: "2026-10-10", note: "Adiantamento" }, s.caixaGestao, NOW);
    const [lan] = await db.select().from(auditLog).where(eq(auditLog.action, "ajuste_lancado"));
    expect(lan).toMatchObject({ userId: s.gestora.id, entityId: add.id });
    expect(lan.data).toMatchObject({ antes: null, depois: { kind: "vale", valueCents: 5000 }, motivo: "Adiantamento" });
    await expect(cancelAdjustment(add.id, { reason: " " }, s.caixaGestao)).rejects.toThrow("Escreva o motivo.");
    await cancelAdjustment(add.id, { reason: "Lançado errado" }, s.caixaGestao, NOW);
    const [row] = await db.select().from(professionalAdjustments).where(eq(professionalAdjustments.id, add.id));
    expect(row).toMatchObject({ cancelReason: "Lançado errado", cancelledBy: s.gestora.id });
    expect((await listAdjustments({ from: "2026-10-01", to: "2026-10-31" })).filter((r) => !r.cancelledAt)).toHaveLength(0);
  });

  it("não cancela o que já entrou num pagamento", async () => {
    const add = await addAdjustment({ professionalId: s.ana.id, kind: "bonus", valueCents: 100, day: "2026-10-10", note: "x" }, s.caixaGestao);
    const { commissionPayouts } = await import("../../db/schema");
    const [p] = await db.insert(commissionPayouts).values({ professionalId: s.ana.id, fromDay: "2026-10-01", untilDay: "2026-10-31", paidBy: s.gestora.id }).returning();
    await db.update(professionalAdjustments).set({ payoutId: p.id }).where(eq(professionalAdjustments.id, add.id));
    await expect(cancelAdjustment(add.id, { reason: "x" }, s.caixaGestao)).rejects.toThrow("Desfaça o pagamento em Comissão antes.");
  });

  it("liga/desliga: 'vales' desligado recusa lançar e salvar regra, não gera os 'todo mês', mas cancelar continua", async () => {
    const { id } = await saveAdjustmentRule(RULE(), s.caixaGestao);
    const add = await addAdjustment({ professionalId: s.ana.id, kind: "vale", valueCents: 5000, day: "2026-10-10", note: "Adiantamento" }, s.caixaGestao);
    await setSetting("caixa_recursos", { ...CAIXA_RECURSOS_PADRAO, vales: false });
    const off = "Vale, bônus e desconto na comissão está desligado em Configurações › Caixa.";
    await expect(addAdjustment({ professionalId: s.ana.id, kind: "vale", valueCents: 1, day: "2026-10-10", note: "x" }, s.caixaGestao)).rejects.toThrow(off);
    await expect(saveAdjustmentRule(RULE({ id }), s.caixaGestao)).rejects.toThrow(off);
    expect(await db.transaction((tx) => materializeRulesTx(tx, "2026-10-18"))).toBe(0);
    await cancelAdjustment(add.id, { reason: "Desfeito" }, s.caixaGestao);
    expect((await db.select().from(professionalAdjustments)).filter((a) => a.id === add.id && a.cancelledAt)).toHaveLength(1);
  });

  it("nunca gera o futuro: materializar até 2099 só vai até hoje", async () => {
    await saveAdjustmentRule(RULE(), s.caixaGestao);
    expect(await db.transaction((tx) => materializeRulesTx(tx, "2099-12-31", undefined, NOW))).toBe(3);
    expect((await db.select().from(professionalAdjustments)).map((a) => a.day).sort()).toEqual(["2026-08-05", "2026-09-05", "2026-10-05"]);
  });
});
