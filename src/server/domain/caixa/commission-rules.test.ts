import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, lists, professionals, professionalServices } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { NEUTRAL_COMMISSION_RULES, type CommissionRules } from "@/lib/commission-rules";
import { updateService } from "../services";
import { getCommissionRules, saveCommissionRules, saveProfessionalCommissionRules, setAssistantCommission } from "./commission-rules";

const CASA: CommissionRules = { cartao: "antes", antecipacao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", assistenteSaiDaPrincipalBp: 10000, divida: "quitacao" };

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const audits = (action: string) => db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.createdAt));

describe("regras da comissão", () => {
  it("da Casa: sem linha é o neutro; salvar valida, grava e audita com de/para", async () => {
    expect(await getCommissionRules()).toEqual(NEUTRAL_COMMISSION_RULES);
    await expect(saveCommissionRules({ ...CASA, antecipacaoBp: 10001 }, s.caixaGestao)).rejects.toThrow("Use de 0% a 100%.");
    await expect(saveCommissionRules({ ...CASA, assistenteSaiDaPrincipalBp: -1 }, s.caixaGestao)).rejects.toThrow("Use de 0% a 100%.");
    await expect(saveCommissionRules({ ...CASA, cartao: "talvez" as never }, s.caixaGestao)).rejects.toThrow("Escolha uma das opções.");
    await saveCommissionRules(CASA, s.caixaGestao);
    expect(await getCommissionRules()).toEqual(CASA);
    await saveCommissionRules({ ...CASA, custo: "nao" }, s.caixaGestao);
    expect((await audits("comissao_regras_casa")).map((a) => a.data)).toEqual([
      { de: NEUTRAL_COMMISSION_RULES, para: CASA },
      { de: CASA, para: { ...CASA, custo: "nao" } },
    ]);
  });

  it("da profissional: só os três descontos; null volta a seguir a Casa; audita com de/para", async () => {
    await saveProfessionalCommissionRules(s.bia.id, { custo: "nao" }, s.caixaGestao);
    expect((await db.select().from(professionals).where(eq(professionals.id, s.bia.id)))[0].commissionRules).toEqual({ custo: "nao" });
    await saveProfessionalCommissionRules(s.bia.id, null, s.caixaGestao);
    expect((await db.select().from(professionals).where(eq(professionals.id, s.bia.id)))[0].commissionRules).toBeNull();
    await expect(saveProfessionalCommissionRules(randomUUID(), { custo: "nao" }, s.caixaGestao)).rejects.toThrow("Profissional não encontrada.");
    await expect(saveProfessionalCommissionRules(s.bia.id, { cartao: "x" as never }, s.caixaGestao)).rejects.toThrow("Escolha uma das opções.");
    expect((await audits("comissao_regras_profissional")).map((a) => [a.entityId, a.data])).toEqual([
      [s.bia.id, { de: null, para: { custo: "nao" } }],
      [s.bia.id, { de: { custo: "nao" }, para: null }],
    ]);
  });

  it("% da assistente na linha da principal × serviço: só nos serviços que ela faz; audita com de/para", async () => {
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao);
    const bp = async () => (await db.select().from(professionalServices).where(and(eq(professionalServices.professionalId, s.ana.id), eq(professionalServices.serviceId, s.corte.id))))[0].assistantBp;
    expect(await bp()).toBe(1000);
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 1000 }, s.caixaGestao); // igual: sem rastro
    const [manicure] = await db.insert(lists).values({ kind: "service", label: "Manicure", category: "Unhas", position: 99 }).returning();
    await expect(setAssistantCommission({ professionalId: s.ana.id, serviceId: manicure.id, bp: 1000 }, s.caixaGestao)).rejects.toThrow("Ela não faz esse serviço: marque em Profissionais primeiro.");
    await expect(setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: 10001 }, s.caixaGestao)).rejects.toThrow("Use de 0% a 100%.");
    await setAssistantCommission({ professionalId: s.ana.id, serviceId: s.corte.id, bp: null }, s.caixaGestao);
    expect(await bp()).toBeNull();
    expect((await audits("comissao_assistente")).map((a) => [a.entityId, a.data])).toEqual([
      [s.ana.id, { servico: s.corte.id, de: null, para: 1000 }],
      [s.ana.id, { servico: s.corte.id, de: 1000, para: null }],
    ]);
  });

  it("custo do serviço: grava, apaga e recusa negativo", async () => {
    await updateService(s.corte.id, { costCents: 1000 }, s.gestora.id);
    const cost = async () => (await db.select().from(lists).where(eq(lists.id, s.corte.id)))[0].costCents;
    expect(await cost()).toBe(1000);
    await expect(updateService(s.corte.id, { costCents: -1 }, s.gestora.id)).rejects.toThrow(/Confira o custo: use um valor como/);
    await updateService(s.corte.id, { costCents: null }, s.gestora.id);
    expect(await cost()).toBeNull();
  });
});
