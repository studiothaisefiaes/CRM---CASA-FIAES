import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { comandaItems, comandas, deals, professionals, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { assignDayVisits } from "../domain/agenda/visits";
import { dayVisitFor, dayVisitsOf } from "./day-visit";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

describe("visita do dia: a 'comanda de tudo que a pessoa vai fazer hoje' (17/10)", () => {
  it("junta os serviços da cliente no dia (com a assistente e a principal), sem espera nem cancelado sem hora; preço da comanda do Caixa quando existe", async () => {
    await db.update(professionals).set({ assistantOf: s.ana.id }).where(eq(professionals.id, s.bia.id));
    const p = await cliente("Cristiana Souza", { stage: "atendimento" });
    const a = await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, contactId: p.contactId, serviceLabel: "Luzes e Mechas", priceCents: 58000, status: "confirmado" });
    const b = await ap({ startsAt: bahia(16, 9), professionalId: s.bia.id, contactId: p.contactId, serviceLabel: "Coloração", serviceId: s.hidratacao.id, durationMin: null });
    await ap({ startsAt: bahia(16, 0), status: "espera", contactId: p.contactId, serviceLabel: "Luzes e Mechas", externalKey: "avec:esp:1" });
    await ap({ startsAt: bahia(16, 0), status: "cancelado", contactId: p.contactId, externalKey: "avec:res:2026-10-16T--:--|cris|x" });
    const c = await ap({ startsAt: bahia(16, 15), status: "cancelado", contactId: p.contactId, professionalId: s.ana.id, serviceLabel: "Escova" });
    await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, contactId: (await cliente("Outra")).contactId });
    await assignDayVisits();
    const v = await dayVisitFor(b.id, { withValues: true });
    expect(v).toMatchObject({ name: "Cristiana Souza", day: "2026-10-16", entry: bahia(16, 9).toISOString(), dealId: p.dealId, comanda: null, values: true });
    expect(v!.visitId).not.toBeNull();
    expect(v!.services.map((x) => [x.appointmentId, x.service, x.pro, x.assistant, x.status, x.priceCents, x.end])).toEqual([
      [a.id, "Luzes e Mechas", "Ana", null, "confirmado", 58000, bahia(16, 10).toISOString()],
      [b.id, "Coloração", "Ana", "Bia", "agendado", 9000, bahia(16, 9, 45).toISOString()], // sem duração no horário: a do serviço; sem preço: o do serviço
    ]);
    expect(v!.cancelled.map((x) => x.appointmentId)).toEqual([c.id]);

    // Com a comanda do Caixa aberta, o valor do item manda e a comanda aparece.
    const [cm] = await db.insert(comandas).values({ day: "2026-10-16", number: 7, contactId: p.contactId, clientName: "Cristiana Souza", visitId: v!.visitId, openedBy: s.cati.id }).returning();
    await db.insert(comandaItems).values({ comandaId: cm.id, kind: "servico", label: "Coloração", appointmentId: b.id, professionalId: s.bia.id, unitCents: 18000, totalCents: 18000 });
    const v2 = await dayVisitFor(a.id, { withValues: false });
    expect(v2!.comanda).toEqual({ id: cm.id, number: 7, status: "aberta" });
    expect(v2!.values).toBe(false);
    expect(v2!.services.map((x) => x.priceCents)).toEqual([null, null]);
    expect((await dayVisitFor(a.id, { withValues: true }))!.services.map((x) => x.priceCents)).toEqual([58000, 18000]);
  });

  it("o dia inteiro: uma visita por cliente, em ordem de entrada; horário de espera às 00:00 não vira visita", async () => {
    const p = await cliente("Paula");
    const r = await cliente("Rita");
    await ap({ startsAt: bahia(16, 11), professionalId: s.ana.id, contactId: p.contactId });
    await ap({ startsAt: bahia(16, 9), professionalId: s.bia.id, contactId: r.contactId });
    await ap({ startsAt: bahia(16, 14), professionalId: s.bia.id, contactId: p.contactId });
    await ap({ startsAt: bahia(16, 0), status: "espera", contactId: (await cliente("So Espera")).contactId, externalKey: "avec:esp:2" });
    const all = await dayVisitsOf("2026-10-16", { withValues: true });
    expect(all.map((v) => [v.name, v.services.length])).toEqual([["Rita", 1], ["Paula", 2]]);
    void deals; void stages;
  });

  it("Hoje v3: serviço com a primeira maiúscula (nunca TUDO EM MAIÚSCULAS), Na Casa desde (Chegou ou Começou) e quando cancelou", async () => {
    const p = await cliente("Thamires");
    const chegou = new Date(bahia(16, 8, 40).getTime());
    await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, contactId: p.contactId, serviceLabel: "LUZES E MECHAS", status: "chegou", arrivedAt: chegou });
    await ap({ startsAt: bahia(16, 10), professionalId: s.bia.id, contactId: p.contactId, serviceLabel: "Escova", status: "em_atendimento", startedAt: bahia(16, 8, 30) });
    const cancelou = bahia(15, 18);
    await ap({ startsAt: bahia(16, 11), professionalId: s.bia.id, contactId: p.contactId, serviceLabel: "Manicure", status: "cancelado", cancelledAt: cancelou });
    const [v] = await dayVisitsOf("2026-10-16", { withValues: false });
    expect(v.services.map((x) => [x.service, x.arrivedAt])).toEqual([
      ["Luzes e Mechas", chegou.toISOString()],
      ["Escova", bahia(16, 8, 30).toISOString()],
    ]);
    expect(v.cancelled.map((x) => x.cancelledAt)).toEqual([cancelou.toISOString()]);
  });

  it("Hoje v3: a visita aberta pelo painel também fica sem o horário das 00:00 (o mesmo corte da tabela)", async () => {
    const p = await cliente("Rose");
    const real = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, contactId: p.contactId, serviceLabel: "Corte" });
    await ap({ startsAt: bahia(16, 0), contactId: p.contactId, serviceLabel: "Escova", status: "agendado" });
    const v = await dayVisitFor(real.id, { withValues: false });
    expect(v!.services.map((x) => x.service)).toEqual(["Corte"]);
    expect(v!.entry).toBe(bahia(16, 10).toISOString());
  });

  it("Hoje v3: cancelado pelo Avec (sem cancelled_at) usa a hora em que a importação gravou o cancelamento", async () => {
    const p = await cliente("Vera");
    const quando = bahia(16, 8);
    await ap({ startsAt: bahia(16, 11), professionalId: s.ana.id, contactId: p.contactId, status: "cancelado", origin: "avec", updatedAt: quando });
    const crm = bahia(15, 20);
    await ap({ startsAt: bahia(16, 12), professionalId: s.ana.id, contactId: p.contactId, status: "cancelado", origin: "crm", cancelledAt: crm, updatedAt: bahia(16, 9) });
    const [v] = await dayVisitsOf("2026-10-16", { withValues: false });
    expect(v.cancelled.map((x) => x.cancelledAt)).toEqual([quando.toISOString(), crm.toISOString()]);
  });
});

describe("status conferir (Avec que o CRM não conhece) fica fora do quadro do dia (17/10)", () => {
  it("não aparece como visita (senão cairia em Finalizou)", async () => {
    const p = await cliente("Ana Souza");
    await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, contactId: p.contactId, status: "conferir", avecStatus: "Aguardando" });
    expect(await dayVisitsOf("2026-10-16", { withValues: false })).toEqual([]);
  });
});
