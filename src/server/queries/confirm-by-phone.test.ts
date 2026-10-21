import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { listConfirmByPhone } from "./confirm-by-phone";

// 17/10: 35% das clientes da semana não têm conversa no CRM e por isso não recebem o lembrete. A recepção confirma por telefone.
const NOW = bahia(16, 10); // amanhã = 17/10
let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const deal = async (contactId: string, o: Partial<typeof deals.$inferInsert> = {}) => {
  const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
  await db.insert(deals).values({ contactId, stageId: st.id, ...o });
};

describe("Pendências › Confirmar por telefone", () => {
  it("cliente com horário amanhã e sem conversa entra uma vez, com telefone, hora e serviços", async () => {
    const p = await cliente("Beatriz Souza");
    await ap({ startsAt: bahia(17, 9), contactId: p.contactId, professionalId: s.ana.id, serviceLabel: "Luzes" });
    await ap({ startsAt: bahia(17, 9), contactId: p.contactId, professionalId: s.bia.id, serviceLabel: "Não informado" });
    expect(await listConfirmByPhone(NOW)).toEqual([{
      contactId: p.contactId, name: "Beatriz Souza", phone: p.phone, firstStart: bahia(17, 9).toISOString(),
      services: [{ service: "Luzes", pro: "Ana" }, { service: "Atendimento", pro: "Bia" }],
    }]);
  });

  it("fica de fora: com lead aberto ou fechado não arquivado, sem telefone, CLIENTE PADRÃO, Equipe, horário cancelado, hoje ou depois de amanhã", async () => {
    const aberta = await cliente("Com Conversa", { stage: "atendimento" });
    const fechada = await cliente("Conversa Fechada");
    await deal(fechada.contactId, { closedAt: bahia(1, 10) });
    const [semTel] = await db.insert(contacts).values({ name: "Sem Telefone", phoneE164: "lid:5551234" }).returning(); // número oculto, sem outro telefone
    const [padrao] = await db.insert(contacts).values({ name: "CLIENTE PADRÃO", phoneE164: "+5571999990077" }).returning();
    const equipe = await cliente("Da Equipe");
    await db.update(contacts).set({ kind: "equipe" }).where(eq(contacts.id, equipe.contactId));
    const cancelada = await cliente("Cancelada");
    const hoje = await cliente("Vem Hoje");
    const depois = await cliente("Vem Depois");
    for (const id of [aberta.contactId, fechada.contactId, semTel.id, padrao.id, equipe.contactId]) await ap({ startsAt: bahia(17, 10), contactId: id, professionalId: s.ana.id });
    await ap({ startsAt: bahia(17, 11), contactId: cancelada.contactId, professionalId: s.ana.id, status: "cancelado" });
    await ap({ startsAt: bahia(16, 15), contactId: hoje.contactId, professionalId: s.ana.id });
    await ap({ startsAt: bahia(18, 10), contactId: depois.contactId, professionalId: s.ana.id });
    expect(await listConfirmByPhone(NOW)).toEqual([]);
  });

  it("lead arquivado não conta como conversa; pessoa a mais no número vale pela conversa do titular", async () => {
    const arquivada = await cliente("Lead Arquivado");
    await deal(arquivada.contactId, { archivedAt: bahia(1, 10) });
    const mae = await cliente("Mãe Souza", { stage: "atendimento" });
    const [filha] = await db.insert(contacts).values({ name: "Filha Souza", phoneE164: "pessoa:filha", sharesPhoneWith: mae.contactId }).returning();
    const tia = await cliente("Tia Lima");
    const [sobrinha] = await db.insert(contacts).values({ name: "Sobrinha Lima", phoneE164: "pessoa:sobrinha", sharesPhoneWith: tia.contactId }).returning();
    await ap({ startsAt: bahia(17, 9), contactId: arquivada.contactId, professionalId: s.ana.id });
    await ap({ startsAt: bahia(17, 10), contactId: filha.id, professionalId: s.ana.id });
    await ap({ startsAt: bahia(17, 11), contactId: sobrinha.id, professionalId: s.ana.id });
    expect((await listConfirmByPhone(NOW)).map((i) => [i.name, i.phone])).toEqual([["Lead Arquivado", arquivada.phone], ["Sobrinha Lima", tia.phone]]);
  });

  it("revisão final: depois de confirmada, sai da lista (e do sino)", async () => {
    const p = await cliente("Ja Confirmou");
    await ap({ startsAt: bahia(17, 9), contactId: p.contactId, professionalId: s.ana.id, status: "confirmado", confirmedAt: NOW });
    expect(await listConfirmByPhone(NOW)).toEqual([]);
  });
});
