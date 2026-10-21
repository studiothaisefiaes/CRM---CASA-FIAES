import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, salesItems } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../../test/agenda-fixtures";
import { undoAvecOverclose } from "./undo-overclose";

// 18/10 (QA r58, I-14): a limpeza fechou como compareceu todos os horários do dia da cliente com venda e juntou o Atendimento do lead
// com qualquer horário do Avec do dia. A correção desfaz só o que a regra nova não faria.
const CLEAN_AT = new Date("2026-10-18T11:50:00Z");
const NOW = bahia(18, 12);
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); }, 60_000);
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
const snapshot = async () => (await db.execute(sql`select md5(string_agg(t::text, '|' order by t::text)) as h from (
  select id, status, avec_status, avec_review, deal_id, cancelled_at from appointments) t`)).rows[0];

/** O que a limpeza de 18/10 fez (regra antiga): compareceu, status de antes em avec_status e o audit_log. */
async function oldClose(id: string) {
  const r = await db.execute(sql`update appointments a set status = 'compareceu', avec_status = coalesce(a.avec_status, a.status), updated_at = ${CLEAN_AT.toISOString()}::timestamptz
    where a.id = ${id} returning a.avec_status as de`);
  await db.insert(auditLog).values({ action: "avec_baixa_comanda", entity: "appointment", entityId: id, data: { de: (r.rows[0] as { de: string }).de, para: "compareceu" }, createdAt: CLEAN_AT });
}
async function oldJoin(holderId: string, avecIds: string[], dealId: string | null) {
  await db.update(appointments).set({ status: "cancelado", cancelReason: "outro", cancelNote: "Junto com o horário do Avec do mesmo dia.", cancelledVia: "avec", cancelledAt: CLEAN_AT, updatedAt: CLEAN_AT })
    .where(eq(appointments.id, holderId));
  for (const id of avecIds) await db.update(appointments).set({ dealId, updatedAt: CLEAN_AT }).where(eq(appointments.id, id));
  await db.insert(auditLog).values({ action: "avec_juntou_atendimento", entity: "appointment", entityId: holderId, data: { de: "agendado", para: "cancelado", avec: avecIds }, createdAt: CLEAN_AT });
}

describe("scripts/corrigir-avec-baixas (undoAvecOverclose)", () => {
  it("desfaz só o que a regra nova não faria; --dry-run não grava; rodar de novo não faz nada", async () => {
    const k = await cliente("Karina Teste");
    const corte = await ap({ startsAt: bahia(13, 10), contactId: k.contactId, professionalId: s.ana.id, serviceId: s.corte.id, serviceLabel: "Corte" });
    const mechas = await ap({ startsAt: bahia(13, 15), contactId: k.contactId, professionalId: s.bia.id, serviceId: s.mechas.id, serviceLabel: "Mechas", status: "confirmado" });
    const soPagamento = await ap({ startsAt: bahia(14, 9), contactId: k.contactId, professionalId: s.bia.id, status: "conferir", avecStatus: "Aguardando" });
    const mexido = await ap({ startsAt: bahia(13, 16), contactId: k.contactId, professionalId: s.bia.id, serviceLabel: "Hidratação" });
    await db.insert(salesItems).values({ externalKey: "avec:item:k", contactId: k.contactId, soldOn: "2026-10-13", item: "Corte", kind: "servico", origin: "avec", totalCents: 100 });
    for (const a of [corte, mechas, soPagamento, mexido]) await oldClose(a.id);
    await db.update(appointments).set({ status: "faltou", crmTouchedAt: NOW }).where(eq(appointments.id, mexido.id)); // a recepção já corrigiu
    // Baixa feita depois pela regra NOVA (pagamento com hora): fica fora do script, mesmo sem itens no dia (revisão: ida e volta).
    const regraNova = await ap({ startsAt: bahia(15, 9), contactId: k.contactId, professionalId: s.ana.id, status: "compareceu", avecStatus: "agendado" });
    await db.insert(auditLog).values({ action: "avec_baixa_comanda", entity: "appointment", entityId: regraNova.id, data: { de: "agendado", para: "compareceu", regra: 2 }, createdAt: NOW });

    const l = await cliente("Lia Teste", { stage: "agendado" });
    const longe = await ap({ startsAt: bahia(20, 15), contactId: l.contactId, dealId: l.dealId, origin: "crm", serviceLabel: "Atendimento", professionalId: null, externalKey: "crm:l" });
    const avecCedo = await ap({ startsAt: bahia(20, 9), contactId: l.contactId, professionalId: s.ana.id });
    await oldJoin(longe.id, [avecCedo.id], l.dealId);
    const p = await cliente("Pia Teste", { stage: "agendado" });
    const perto = await ap({ startsAt: bahia(21, 10), contactId: p.contactId, dealId: p.dealId, origin: "crm", serviceLabel: "Atendimento", professionalId: null, externalKey: "crm:p" });
    const avecPerto = await ap({ startsAt: bahia(21, 11), contactId: p.contactId, professionalId: s.ana.id });
    await oldJoin(perto.id, [avecPerto.id], p.dealId);

    const ESPERADO = {
      espera: { total: 0, apagadas: 0, ficam: 0 },
      baixas: { total: 4, ficam: 1, desfeitas: 2, semItens: 1, mexidos: 1, jaDesfeitas: 0, porAno: { "2026": 2 }, porDia: { "2026-10-18": 2 }, conversasMovidas: 0 },
      atendimentos: { total: 2, ficam: 1, desfeitos: 1, mexidos: 0, jaDesfeitos: 0 },
    };
    const before = await snapshot();
    expect(await undoAvecOverclose({ apply: false, now: NOW })).toEqual(ESPERADO);
    expect(await snapshot()).toEqual(before);

    expect(await undoAvecOverclose({ apply: true, now: NOW })).toEqual(ESPERADO);
    expect((await get(corte.id)).status).toBe("compareceu");
    expect((await get(regraNova.id)).status).toBe("compareceu");
    expect(await get(mechas.id)).toMatchObject({ status: "confirmado", avecStatus: null, avecReview: "venda_sem_par" });
    expect(await get(soPagamento.id)).toMatchObject({ status: "conferir", avecStatus: "Aguardando", avecReview: "venda_sem_par" });
    expect(await get(mexido.id)).toMatchObject({ status: "faltou" });
    expect(await get(longe.id)).toMatchObject({ status: "agendado", cancelledAt: null, cancelNote: null, cancelledVia: null, avecReview: "atendimento_longe", dealId: l.dealId });
    expect((await get(avecCedo.id)).dealId).toBeNull();
    expect((await get(perto.id)).status).toBe("cancelado");
    expect((await get(avecPerto.id)).dealId).toBe(p.dealId);

    // Dá para saber exatamente o que o script mudou: cada desfeito aponta para o registro original.
    const audit = await db.select().from(auditLog);
    const desfeitas = audit.filter((x) => x.action === "avec_baixa_desfeita");
    expect(desfeitas.map((x) => x.entityId).sort()).toEqual([mechas.id, soPagamento.id].sort());
    const origem = new Set(audit.filter((x) => x.action === "avec_baixa_comanda").map((x) => x.id));
    for (const d of desfeitas) expect(origem.has((d.data as { auditId: string }).auditId)).toBe(true);
    expect(audit.filter((x) => x.action === "avec_atendimento_desfeito").map((x) => x.entityId)).toEqual([longe.id]);

    expect(await undoAvecOverclose({ apply: true, now: NOW })).toEqual({
      espera: { total: 0, apagadas: 0, ficam: 0 },
      baixas: { total: 4, ficam: 1, desfeitas: 0, semItens: 0, mexidos: 1, jaDesfeitas: 2, porAno: {}, porDia: {}, conversasMovidas: 0 },
      atendimentos: { total: 2, ficam: 1, desfeitos: 0, mexidos: 0, jaDesfeitos: 1 },
    });
  }, 120_000);
});

// Gap Avec (A1): o 0248 "Agendamentos por status › Agendado" entrava como lista de espera ("espera" às 00:00, chave avec:esp:).
describe("lixo do 0248 na lista de espera", () => {
  it("apaga os \"espera\" do Avec que nada referencia; o que tem conversa, comanda, nota ou foi mexido no CRM fica; idempotente", async () => {
    const k = await cliente("Kel Teste", { stage: "agendado" });
    const esp = (n: number, o: Partial<typeof appointments.$inferInsert> = {}) =>
      ap({ startsAt: bahia(10 + n, 0), contactId: k.contactId, status: "espera", externalKey: `avec:esp:2026-10-${10 + n}|kel teste|corte${n}`, ...o });
    const solto1 = await esp(1), solto2 = await esp(2, { status: "espera_desistiu" });
    const comConversa = await esp(3, { dealId: k.dealId });
    const mexido = await esp(4, { crmTouchedAt: NOW });
    const doCrm = await ap({ startsAt: bahia(15, 0), contactId: k.contactId, status: "espera", origin: "crm", externalKey: "crm:espera" });
    const before = await snapshot();
    expect((await undoAvecOverclose({ apply: false, now: NOW })).espera).toEqual({ total: 4, apagadas: 2, ficam: 2 });
    expect(await snapshot()).toEqual(before);
    expect((await undoAvecOverclose({ apply: true, now: NOW })).espera).toEqual({ total: 4, apagadas: 2, ficam: 2 });
    const ids = (await db.select({ id: appointments.id }).from(appointments)).map((a) => a.id);
    expect(ids).not.toContain(solto1.id);
    expect(ids).not.toContain(solto2.id);
    for (const a of [comConversa, mexido, doCrm]) expect(ids).toContain(a.id);
    const audit = (await db.select().from(auditLog)).filter((l) => l.action === "avec_espera_apagada");
    expect(audit.map((l) => l.entityId).sort()).toEqual([solto1.id, solto2.id].sort());
    expect((audit[0].data as { chave: string }).chave).toMatch(/^avec:esp:/);
    expect((await undoAvecOverclose({ apply: true, now: NOW })).espera).toEqual({ total: 2, apagadas: 0, ficam: 2 });
  }, 120_000);

  it("QA r66 I-3: também desfaz baixa da regra por venda (regra 2) que só tinha a profissional; a que tem o serviço fica", async () => {
    const k = await cliente("Rita Teste");
    const hidra = await ap({ startsAt: bahia(13, 15), contactId: k.contactId, professionalId: s.ana.id, serviceId: s.hidratacao.id, serviceLabel: "Hidratação", status: "compareceu", avecStatus: "agendado" });
    const corte = await ap({ startsAt: bahia(13, 10), contactId: k.contactId, professionalId: s.ana.id, serviceId: s.corte.id, serviceLabel: "Corte", status: "compareceu", avecStatus: "agendado" });
    await db.insert(salesItems).values({ externalKey: "avec:item:r", contactId: k.contactId, soldOn: "2026-10-13", item: "Corte", kind: "servico", professionalId: s.ana.id, origin: "avec", totalCents: 100 });
    for (const a of [hidra, corte]) await db.insert(auditLog).values({ action: "avec_baixa_comanda", entity: "appointment", entityId: a.id, data: { de: "agendado", para: "compareceu", regra: 2 }, createdAt: NOW });
    const r = await undoAvecOverclose({ apply: true, now: NOW });
    expect(r.baixas).toMatchObject({ desfeitas: 1, ficam: 1 });
    expect(await get(hidra.id)).toMatchObject({ status: "agendado", avecReview: "venda_sem_par" });
    expect((await get(corte.id)).status).toBe("compareceu");
  });
});
