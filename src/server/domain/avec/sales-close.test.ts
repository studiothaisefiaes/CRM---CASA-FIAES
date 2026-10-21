import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../../test/agenda-fixtures";
import { AVEC_H, importa, item, pagamento } from "../../../../test/avec-fixtures";
import { listAvecDivergences } from "../agenda/twins";

// 17/10: "já pagaram" no Avec e o CRM em agendado (26 sem baixa em 7 dias; caso Karina, com gêmeo do Avec em compareceu).
const NOW = bahia(17, 12);
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];

describe("comanda ou pagamento do Avec dá baixa no horário da cliente no dia", () => {
  it("caso Karina: horário do CRM agendado + item de comanda no dia → compareceu, guardando o status antigo", async () => {
    const k = await cliente("Karina Teste");
    const crm = await ap({ startsAt: bahia(16, 10), contactId: k.contactId, professionalId: s.ana.id, origin: "crm", externalKey: "crm:k" });
    const r = await importa("itens.xlsx", AVEC_H.itens, [item({ dia: "16/10/2026", comanda: 77, cliente: "Karina Teste", celular: Number(k.digits) })], { now: NOW });
    expect(r.summary.itensVenda).toBe(1);
    expect(await get(crm.id)).toMatchObject({ status: "compareceu", avecStatus: "agendado", crmTouchedAt: null, finishedAt: NOW }); // Fase B: a hora da baixa
    expect((await db.select().from(auditLog)).filter((l) => l.action === "avec_baixa_comanda")).toHaveLength(1);
  });

  it("pagamento sem detalhe e sem hora (o Avec só traz a data): não fecha nada e marca para conferir", async () => {
    const b = await cliente("Bia Teste");
    const a1 = await ap({ startsAt: bahia(15, 9), contactId: b.contactId, professionalId: s.ana.id, status: "confirmado" });
    const a2 = await ap({ startsAt: bahia(15, 10), contactId: b.contactId, professionalId: s.bia.id, status: "conferir", avecStatus: "Aguardando" });
    await importa("pag.xlsx", AVEC_H.pagamentos, [pagamento({ dia: "15/10/2026", comanda: 5, cliente: "Bia Teste" })], { now: NOW });
    expect(await get(a1.id)).toMatchObject({ status: "confirmado", avecReview: "venda_sem_par" });
    expect(await get(a2.id)).toMatchObject({ status: "conferir", avecStatus: "Aguardando", avecReview: "venda_sem_par" });
    expect((await db.select().from(auditLog)).filter((l) => l.action === "avec_baixa_comanda")).toHaveLength(0);
  });

  it("pagamento com hora e sem detalhe: fecha só os horários que já tinham começado antes da venda", async () => {
    const b = await cliente("Bela Teste");
    const antes = await ap({ startsAt: bahia(15, 9), contactId: b.contactId, professionalId: s.ana.id });
    const depois = await ap({ startsAt: bahia(15, 14), contactId: b.contactId, professionalId: s.bia.id, serviceLabel: "Hidratação" });
    const row = pagamento({ dia: "15/10/2026", comanda: 6, cliente: "Bela Teste" });
    row[7] = "15/10/2026 10:30:00"; // Data Pagamento com a hora
    await importa("pag.xlsx", AVEC_H.pagamentos, [row], { now: NOW });
    expect((await get(antes.id)).status).toBe("compareceu");
    expect(await get(depois.id)).toMatchObject({ status: "agendado", avecReview: "venda_sem_par" });
  });

  it("venda com detalhe fecha só o horário do serviço vendido (a profissional sozinha não basta); o resto fica e vai para conferir", async () => {
    const c = await cliente("Carla Teste");
    const daAna = await ap({ startsAt: bahia(16, 9), contactId: c.contactId, professionalId: s.ana.id, serviceId: s.corte.id, serviceLabel: "Corte" });
    const doServico = await ap({ startsAt: bahia(16, 11), contactId: c.contactId, professionalId: s.bia.id, serviceId: s.hidratacao.id, serviceLabel: "Hidratação" });
    const outro = await ap({ startsAt: bahia(16, 14), contactId: c.contactId, professionalId: s.bia.id, serviceId: s.mechas.id, serviceLabel: "Mechas" });
    await importa("itens.xlsx", AVEC_H.itens, [item({ dia: "16/10/2026", comanda: 31, cliente: "Carla Teste", celular: Number(c.digits), servico: "Hidratacao", pro: "Ana Lima" })], { now: NOW });
    expect((await get(doServico.id)).status).toBe("compareceu");
    expect(await get(daAna.id)).toMatchObject({ status: "agendado", avecReview: "venda_sem_par" }); // QA r66, I-3: só a profissional não fecha
    expect(await get(outro.id)).toMatchObject({ status: "agendado", avecReview: "venda_sem_par" });
    const conferir = await listAvecDivergences({ from: bahia(10, 0), to: bahia(20, 0) });
    expect(conferir.filter((d) => d.kind === "venda_sem_par").map((d) => d.appointmentId).sort()).toEqual([daAna.id, outro.id].sort());
    const audit = await db.select().from(auditLog);
    expect(audit.filter((l) => l.action === "avec_venda_conferir").map((l) => l.entityId).sort()).toEqual([daAna.id, outro.id].sort());
    // Importar de novo não repete nada.
    await importa("itens.xlsx", AVEC_H.itens, [item({ dia: "16/10/2026", comanda: 31, cliente: "Carla Teste", celular: Number(c.digits), servico: "Hidratacao", pro: "Ana Lima" })], { now: NOW });
    const again = await db.select().from(auditLog);
    expect(again.filter((l) => l.action === "avec_venda_conferir")).toHaveLength(2);
    expect(again.filter((l) => l.action === "avec_baixa_comanda")).toHaveLength(1);
  });

  it("item só de produto, sem profissional, não é detalhe: sem hora da venda, nada fecha", async () => {
    const d = await cliente("Dora Teste");
    const a = await ap({ startsAt: bahia(16, 9), contactId: d.contactId, professionalId: s.ana.id });
    const row = item({ dia: "16/10/2026", comanda: 40, cliente: "Dora Teste", celular: Number(d.digits), servico: "Shampoo 250ml", pro: "" });
    row[3] = "Produto";
    await importa("itens.xlsx", AVEC_H.itens, [row], { now: NOW });
    expect(await get(a.id)).toMatchObject({ status: "agendado", avecReview: "venda_sem_par" });
  });

  it("não fecha: horário de hoje que ainda não começou, outro dia, cancelado, faltou", async () => {
    const c = await cliente("Cris Teste");
    const futuro = await ap({ startsAt: bahia(17, 15), contactId: c.contactId, professionalId: s.ana.id });
    const outroDia = await ap({ startsAt: bahia(14, 15), contactId: c.contactId, professionalId: s.ana.id });
    const cancelado = await ap({ startsAt: bahia(17, 8), contactId: c.contactId, professionalId: s.ana.id, status: "cancelado" });
    const faltou = await ap({ startsAt: bahia(17, 9), contactId: c.contactId, professionalId: s.bia.id, status: "faltou" });
    await importa("itens.xlsx", AVEC_H.itens, [item({ dia: "17/10/2026", comanda: 1, cliente: "Cris Teste", celular: Number(c.digits) })], { now: NOW });
    expect([await get(futuro.id), await get(outroDia.id), await get(cancelado.id), await get(faltou.id)].map((a) => a.status)).toEqual(["agendado", "agendado", "cancelado", "faltou"]);
  });

  it("mexido no CRM: o status fica e o Avec anota compareceu (aparece em Conferir com o Avec)", async () => {
    const d = await cliente("Dani Teste");
    const a = await ap({ startsAt: bahia(16, 10), contactId: d.contactId, professionalId: s.ana.id, status: "chegou", crmTouchedAt: bahia(16, 10) });
    await importa("itens.xlsx", AVEC_H.itens, [item({ dia: "16/10/2026", comanda: 9, cliente: "Dani Teste", celular: Number(d.digits) })], { now: NOW });
    expect(await get(a.id)).toMatchObject({ status: "chegou", avecStatus: "compareceu" });
  });

  it("QA r66 I-3: Corte 10:00 e Hidratação 15:00 da mesma profissional, venda só do Corte: fecha o Corte e a Hidratação vai para conferir", async () => {
    const m = await cliente("Carla Duarte");
    const corte = await ap({ startsAt: bahia(16, 10), contactId: m.contactId, professionalId: s.ana.id, serviceId: s.corte.id, serviceLabel: "Corte" });
    const hidra = await ap({ startsAt: bahia(16, 15), contactId: m.contactId, professionalId: s.ana.id, serviceId: s.hidratacao.id, serviceLabel: "Hidratação" });
    await importa("itens.xlsx", AVEC_H.itens, [item({ dia: "16/10/2026", comanda: 51, cliente: "Carla Duarte", celular: Number(m.digits), servico: "Corte", pro: "Ana Lima" })], { now: NOW });
    expect((await get(corte.id)).status).toBe("compareceu");
    expect(await get(hidra.id)).toMatchObject({ status: "agendado", avecReview: "venda_sem_par" });
  });

  it("QA r66 I-3: a baixa grava a hora da venda na auditoria (o script de correção refaz a conta com ela)", async () => {
    const m = await cliente("Nina Teste");
    await ap({ startsAt: bahia(15, 9), contactId: m.contactId, professionalId: s.ana.id });
    const row = pagamento({ dia: "15/10/2026", comanda: 9, cliente: "Nina Teste" });
    row[7] = "15/10/2026 10:30:00";
    await importa("pag.xlsx", AVEC_H.pagamentos, [row], { now: NOW });
    const [l] = (await db.select().from(auditLog)).filter((x) => x.action === "avec_baixa_comanda");
    expect(l.data).toMatchObject({ regra: 2, soldAt: expect.stringMatching(/^2026-10-15T13:30/) });
  });
});
