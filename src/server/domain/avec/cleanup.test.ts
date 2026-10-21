import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { appointments, avecRejectedRows, contacts, salesItems, visits } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../../test/agenda-fixtures";
import { AVEC_H, importa, reserva } from "../../../../test/avec-fixtures";
import { runAvecCleanup } from "./cleanup";

// 17/10: o lixo que a importação antiga deixou em produção sai num lugar só, com --dry-run (mesmos números, nada gravado) e --aplicar.
const NOW = bahia(17, 12);
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); }, 60_000);
const snapshot = async () => (await db.execute(sql`select md5(string_agg(t::text, '|' order by t::text)) as h from (
  select id, status, visit_id, avec_status, deal_id from appointments) t`)).rows[0];

async function lixo() {
  // 00:00 com par vivo (cancela a reserva e apaga o 00:00) e 00:00 cujo par já estava cancelado (só apaga)
  const lu = await cliente("Lu Teste");
  const viva = await ap({ startsAt: bahia(16, 10), contactId: lu.contactId, professionalId: s.ana.id, externalKey: "avec:res:2026-10-16T10:00|lu teste|corte" });
  await ap({ startsAt: bahia(16, 0), contactId: lu.contactId, professionalId: s.ana.id, status: "cancelado", externalKey: "avec:res:2026-10-16T--:--|lu teste|corte" });
  await ap({ startsAt: bahia(15, 9), contactId: lu.contactId, professionalId: s.ana.id, status: "cancelado", externalKey: "avec:res:2026-10-15T09:00|lu teste|corte" });
  await ap({ startsAt: bahia(15, 0), contactId: lu.contactId, professionalId: s.ana.id, status: "cancelado", externalKey: "avec:res:2026-10-15T--:--|lu teste|corte" });
  // CLIENTE PADRÃO com visita
  const [v] = await db.insert(visits).values({ clientName: "CLIENTE PADRÃO", day: "2026-10-16", origin: "avec" }).returning();
  await ap({ startsAt: bahia(16, 11), clientName: "CLIENTE PADRÃO", professionalId: s.bia.id, visitId: v.id, externalKey: "avec:res:2026-10-16T11:00|cliente padrao|corte" });
  // data impossível
  await ap({ startsAt: new Date("4676-11-10T12:00:00Z"), contactId: lu.contactId, professionalId: s.ana.id, externalKey: "avec:res:4676-11-10T09:00|lu teste|corte" });
  // status que o CRM não conhece
  await ap({ startsAt: bahia(14, 9), contactId: lu.contactId, professionalId: s.bia.id, avecStatus: "Aguardando", externalKey: "avec:res:2026-10-14T09:00|lu teste|escova" });
  // Atendimento do lead + reserva do Avec no dia
  const cl = await cliente("Claudia Teste", { stage: "agendado" });
  await ap({ startsAt: bahia(20, 15), contactId: cl.contactId, dealId: cl.dealId, origin: "crm", serviceLabel: "Atendimento", externalKey: "crm:1" });
  await ap({ startsAt: bahia(20, 14), contactId: cl.contactId, professionalId: s.ana.id, externalKey: "avec:res:2026-10-20T14:00|claudia teste|corte" });
  // 18/10: Atendimento com o Avec do dia a mais de 2 h: fica e vai para conferir
  const cl2 = await cliente("Clara Teste", { stage: "agendado" });
  await ap({ startsAt: bahia(20, 17), contactId: cl2.contactId, dealId: cl2.dealId, origin: "crm", serviceLabel: "Atendimento", externalKey: "crm:2" });
  await ap({ startsAt: bahia(20, 9), contactId: cl2.contactId, professionalId: s.ana.id, externalKey: "avec:res:2026-10-20T09:00|clara teste|corte" });
  // passado com venda no dia (parte C do script 05) e "chegou" esquecido mexido no CRM (parte B)
  const k = await cliente("Karina Teste");
  await ap({ startsAt: bahia(13, 10), contactId: k.contactId, professionalId: s.ana.id, externalKey: "avec:res:2026-10-13T10:00|karina teste|corte" });
  // 18/10: outro horário dela no mesmo dia, que não bate com a venda (Corte): não fecha, vai para conferir
  await ap({ startsAt: bahia(13, 15), contactId: k.contactId, professionalId: s.bia.id, serviceLabel: "Mechas", externalKey: "avec:res:2026-10-13T15:00|karina teste|mechas" });
  await ap({ startsAt: bahia(12, 10), contactId: k.contactId, professionalId: s.ana.id, status: "chegou", crmTouchedAt: bahia(12, 10), externalKey: "avec:res:2026-10-12T10:00|karina teste|corte" });
  await db.insert(salesItems).values([
    { externalKey: "avec:item:a", contactId: k.contactId, soldOn: "2026-10-13", item: "Corte", kind: "servico", origin: "avec", totalCents: 100 },
    { externalKey: "avec:item:b", contactId: k.contactId, soldOn: "2026-10-12", item: "Corte", kind: "servico", origin: "avec", totalCents: 100 },
  ]);
  // remarcação antiga: o Reservas guardado (importado depois) não traz mais a reserva das 11:30 da Maria com a MAIARA
  await importa("r.xlsx", AVEC_H.reservas, [reserva({ dia: "15/10/2026", hora: "13:30", cliente: "Carla Werneck", pro: "MAIARA", status: "Pago" })], { now: NOW });
  const [maiara] = await db.execute(sql`select id from professionals where name = 'MAIARA'`).then((r) => r.rows as { id: string }[]);
  await ap({ startsAt: bahia(15, 11, 30), clientName: "Carla Werneck", professionalId: maiara.id, createdAt: new Date("2026-10-01T10:00:00Z"), externalKey: "avec:res:2026-10-15T11:30|carla werneck|corte" });
  await db.insert(contacts).values({ name: "ANA VELHA (COMPLETAR CADASTRO)", phoneE164: "+5571988881111" }); // depois do importa (que já limparia)
  return { viva };
}

const ESPERADO = {
  completarCadastro: 1, cancelSemHora: { casados: 1, apagados: 2 }, padrao: { visitasDesligadas: 1, visitasApagadas: 1 }, datas: { canceladas: 1 }, desconhecidos: 1,
  remarcados: { cancelados: 1, sinalizados: 0 }, juntados: 1, atendimentoConferir: 1, baixas: { fechados: 1, sinalizados: 0, conferir: 1, chegouEsquecido: 1 },
};

describe("scripts/limpar-avec-lixo (runAvecCleanup)", () => {
  it("--dry-run conta e não grava; --aplicar grava os mesmos números; rodar de novo não faz nada", async () => {
    const { viva } = await lixo();
    const before = await snapshot();
    expect(await runAvecCleanup({ apply: false, now: NOW })).toEqual(ESPERADO);
    expect(await snapshot()).toEqual(before);
    expect(await runAvecCleanup({ apply: true, now: NOW })).toEqual(ESPERADO);
    expect((await db.select().from(appointments).where(eq(appointments.id, viva.id)))[0]).toMatchObject({ status: "cancelado", cancelledVia: "avec" });
    expect((await db.select().from(appointments)).filter((a) => a.externalKey.includes("--:--"))).toHaveLength(0);
    expect((await db.select().from(avecRejectedRows)).map((r) => r.day)).toEqual(["4676-11-10"]);
    expect((await db.select().from(appointments).where(eq(appointments.externalKey, "avec:res:4676-11-10T09:00|lu teste|corte")))[0]).toMatchObject({ status: "cancelado", cancelReason: "engano" });
    expect((await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571988881111")))[0].name).toBe("ANA VELHA");
    expect(await runAvecCleanup({ apply: true, now: NOW })).toEqual({
      completarCadastro: 0, cancelSemHora: { casados: 0, apagados: 0 }, padrao: { visitasDesligadas: 0, visitasApagadas: 0 }, datas: { canceladas: 0 }, desconhecidos: 0,
      remarcados: { cancelados: 0, sinalizados: 0 }, juntados: 0, atendimentoConferir: 0, baixas: { fechados: 0, sinalizados: 0, conferir: 0, chegouEsquecido: 0 },
    });
  }, 120_000);
});

describe("revisão final: 00:00 não casa com reserva criada depois dele", () => {
  it("a reserva viva que veio de um relatório mais novo não é cancelada; o 00:00 é apagado", async () => {
    const lu = await cliente("Lu Teste");
    await ap({ startsAt: bahia(16, 0), contactId: lu.contactId, professionalId: s.ana.id, status: "cancelado", externalKey: "avec:res:2026-10-16T--:--|lu teste|corte", createdAt: new Date("2026-10-01T10:00:00Z") });
    const nova = await ap({ startsAt: bahia(16, 14), contactId: lu.contactId, professionalId: s.ana.id, externalKey: "avec:res:2026-10-16T14:00|lu teste|corte", createdAt: new Date("2026-10-10T10:00:00Z") });
    const r = await runAvecCleanup({ apply: true, now: NOW });
    expect(r.cancelSemHora).toEqual({ casados: 0, apagados: 1 });
    expect((await db.select().from(appointments).where(eq(appointments.id, nova.id)))[0].status).toBe("agendado");
  }, 120_000);
});
