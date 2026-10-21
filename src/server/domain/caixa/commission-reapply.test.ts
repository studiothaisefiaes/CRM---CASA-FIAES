import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { comandaItems } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comandaFechada } from "../../../../test/comanda-fixtures";
import { setCommission } from "./commission";
import { saveCommissionRules } from "./commission-rules";
import { savePaymentFee } from "./payment-fees";
import { missingRules, reapplyRules } from "./commission-reapply";
import { payableFor } from "./payouts";

let s: Awaited<ReturnType<typeof setupCaixa>>;
const DAY = "2026-10-14";
beforeEach(async () => {
  await resetDb(); s = await setupCaixa({ estoque: false });
  await savePaymentFee({ method: "credito", brand: "visa", parcelado: false, feeBp: 243 }, s.caixaGestao);
  await saveCommissionRules({ cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" }, s.caixaGestao);
});
const corte = () => comandaFechada(s, { day: DAY, items: [{ serviceId: s.corte.id, professionalId: s.ana.id, unitCents: 20000 }], pays: [{ method: "credito", valueCents: 20000, brand: "visa" }] });
const itemOf = async (comandaId: string) => (await db.select().from(comandaItems).where(eq(comandaItems.comandaId, comandaId)))[0];
const range = { from: "2026-10-01", to: "2026-10-31" };

describe("psico r68 #19: comissão sem regra", () => {
  it("lista o que falta (profissional + serviço) e some quando a regra é aplicada às fechadas, com prévia que não grava", async () => {
    const { comandaId } = await corte(); // sem regra da Ana no Corte
    expect((await itemOf(comandaId)).commissionBp).toBeNull();
    expect(await missingRules(range)).toEqual([expect.objectContaining({ professionalId: s.ana.id, serviceId: s.corte.id, items: 1, baseCents: 20000, hasRuleNow: false })]);
    expect((await payableFor({ professionalId: s.ana.id, until: "2026-10-31" })).pending.length).toBe(1);

    await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao);
    expect(await missingRules(range)).toEqual([expect.objectContaining({ items: 1, hasRuleNow: true })]);

    const prev = await reapplyRules(range, { dryRun: true }, s.caixaGestao);
    expect(prev).toMatchObject({ items: 1, comandas: 1, byProfessional: [{ professionalId: s.ana.id, items: 1, beforeCents: 0, afterCents: 8000 - 194 - 560 }] });
    expect((await itemOf(comandaId)).commissionBp).toBeNull(); // prévia não grava

    const done = await reapplyRules(range, { dryRun: false }, s.caixaGestao);
    expect(done.items).toBe(1);
    const it = await itemOf(comandaId);
    expect(it).toMatchObject({ commissionBp: 4000, commissionBaseCents: 20000, commissionCents: 8000 - 194 - 560 });
    expect(await missingRules(range)).toEqual([]);
    expect((await payableFor({ professionalId: s.ana.id, until: "2026-10-31" })).pending.length).toBe(0);
  });

  it("mudar a regra: aplica % novo às fechadas ainda não pagas; fora do período não mexe", async () => {
    await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 4000 }, s.caixaGestao);
    const { comandaId } = await corte();
    await setCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 5000 }, s.caixaGestao);
    expect((await reapplyRules({ from: "2026-11-01", to: "2026-11-30" }, { dryRun: false }, s.caixaGestao)).items).toBe(0);
    expect((await itemOf(comandaId)).commissionBp).toBe(4000);
    expect((await reapplyRules(range, { dryRun: false }, s.caixaGestao)).items).toBe(1);
    expect((await itemOf(comandaId)).commissionBp).toBe(5000);
  });
});
