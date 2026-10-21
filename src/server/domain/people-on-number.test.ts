import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, contacts, deals, messages, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { bahia, cliente, NOW, setupAgenda } from "../../../test/agenda-fixtures";
import { addPersonToNumber, holderIdOf, numberContactIds, peopleOnNumber } from "./people-on-number";
import { createClient, DuplicatePhoneError, findContactByPhone } from "./new-client";
import { recordInbound } from "./deals";
import { startConversation } from "./start-conversation";
import { createVisit } from "./agenda/visits";
import { updateContactProfile } from "./contact-profile";
import { listContacts } from "../queries/contacts";
import { searchAgendaClients } from "../queries/agenda-clients";
import { getContact } from "../queries/contact";
import { numberPeopleWithNext } from "../queries/number-people";
import { loadConversation } from "../ai/suggest";
import { buildUser } from "../ai/prompt";
import { isHiddenNumber } from "@/lib/phone-client";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

/** Mãe (titular, com a conversa aberta) e a filha no mesmo celular (caso Cati, 16/10). */
async function maeEFilha() {
  const mae = await cliente("Marta Souza", { stage: "atendimento", conversaHaDias: 1 });
  const { contactId: filha } = await addPersonToNumber({ contactId: mae.contactId, name: "Bruna Souza", relation: "Filha", cpf: "529.982.247-25", birthday: "14/11/2005" }, s.cati.id);
  return { mae, filha };
}

describe("várias pessoas no mesmo número: unicidade do telefone", () => {
  it("a pessoa a mais tem ficha própria e telefone 'pessoa:'; o telefone do WhatsApp continua único e é do titular", async () => {
    const { mae, filha } = await maeEFilha();
    const [f] = await db.select().from(contacts).where(eq(contacts.id, filha));
    expect(f).toMatchObject({ name: "Bruna Souza", sharesPhoneWith: mae.contactId, phoneRelation: "filha", cpf: "52998224725", birthDay: 14, birthMonth: 11, birthYear: 2005 });
    expect(f.phoneE164.startsWith("pessoa:")).toBe(true);
    expect(isHiddenNumber(f.phoneE164)).toBe(true);
    expect((await findContactByPhone(mae.phone)).contact?.id).toBe(mae.contactId);
    await expect(createClient({ name: "Bruna Souza", phone: mae.phone }, s.cati.id)).rejects.toBeInstanceOf(DuplicatePhoneError);
    await expect(db.insert(contacts).values({ name: "Outra", phoneE164: mae.phone })).rejects.toThrow();
  });

  it("mensagem do número cai na conversa do titular; a pessoa a mais nunca ganha conversa (Iniciar conversa leva à do titular)", async () => {
    const { mae, filha } = await maeEFilha();
    const r = await recordInbound({ channelId: null, externalId: "M1", phoneRaw: mae.phone.slice(1), pushName: "Bruna", body: "oi, é a Bruna", at: new Date() });
    expect("dealId" in r && r.dealId).toBe(mae.dealId);
    expect((await db.select().from(messages).where(eq(messages.externalId, "M1")))[0].contactId).toBe(mae.contactId);
    expect(await startConversation(filha, s.cati.id)).toEqual({ dealId: mae.dealId, created: false });
    expect(await db.select().from(deals).where(eq(deals.contactId, filha))).toHaveLength(0);
  });

  it("a pessoa a mais ganha WhatsApp próprio pela ficha dela e deixa de estar no número da outra (20/10)", async () => {
    const { filha } = await maeEFilha();
    expect((await updateContactProfile(filha, { phone: "71 98888-7777" }, s.cati.id)).changed).toEqual(["phone"]);
    expect(await holderIdOf(filha)).toBe(filha);
  });
});

describe("adicionar pessoa", () => {
  it("lista titular primeiro; adicionar pela ficha da filha liga ao titular; nome repetido no número é recusado", async () => {
    const { mae, filha } = await maeEFilha();
    const { contactId: marido } = await addPersonToNumber({ contactId: filha, name: "José Souza" }, s.cati.id);
    expect(await holderIdOf(marido)).toBe(mae.contactId);
    expect(await numberContactIds(filha)).toEqual([mae.contactId, filha, marido]);
    const p = await peopleOnNumber(filha);
    expect(p?.people.map((x) => [x.name, x.isHolder, x.relation])).toEqual([["Marta Souza", true, null], ["Bruna Souza", false, "filha"], ["José Souza", false, null]]);
    await expect(addPersonToNumber({ contactId: mae.contactId, name: "bruna  SOUZA" }, s.cati.id)).rejects.toThrow("já está neste número");
    await expect(addPersonToNumber({ contactId: mae.contactId, name: "B" }, s.cati.id)).rejects.toThrow("nome");
    await expect(addPersonToNumber({ contactId: mae.contactId, name: "Lia", cpf: "111.111.111-11" }, s.cati.id)).rejects.toThrow("CPF inválido");
  });

  it("a ficha da filha mostra o número da mãe e as pessoas do número", async () => {
    const { mae, filha } = await maeEFilha();
    const c = await getContact(filha);
    expect(c?.contact.phone).toBe(mae.phone);
    expect(c?.people?.holderName).toBe("Marta Souza");
    expect(c?.people?.people.map((x) => x.id)).toEqual([mae.contactId, filha]);
  });
});

describe("busca (nome, telefone, CPF) acha as duas", () => {
  it("Clientes: pelo telefone vêm mãe e filha (com o telefone da mãe); pelo nome e pelo CPF, a filha", async () => {
    const { mae, filha } = await maeEFilha();
    const byPhone = await listContacts({ q: mae.digits.slice(-8), now: NOW });
    expect(byPhone.rows.map((r) => r.id).sort()).toEqual([mae.contactId, filha].sort());
    expect(byPhone.rows.find((r) => r.id === filha)?.phone).toBe(mae.phone);
    expect((await listContacts({ q: "Bruna", now: NOW })).rows.map((r) => r.id)).toEqual([filha]);
    expect((await listContacts({ q: "529.982.247-25", now: NOW })).rows.map((r) => r.id)).toEqual([filha]);
  });

  it("Marcar horário: a busca pelo telefone traz as duas, a filha com 'usa o número de Marta'", async () => {
    const { mae, filha } = await maeEFilha();
    const hits = await searchAgendaClients(mae.digits.slice(-8));
    expect(hits.map((h) => h.id).sort()).toEqual([mae.contactId, filha].sort());
    expect(hits.find((h) => h.id === filha)).toMatchObject({ name: "Bruna Souza", phone: mae.phone, sharesWith: { name: "Marta Souza", relation: "filha" } });
    expect(hits.find((h) => h.id === mae.contactId)?.sharesWith).toBeNull();
  });
});

describe("marcar horário para a pessoa do número", () => {
  it("pela conversa da mãe, o horário fica na ficha da filha; o funil da conversa da mãe vai para Agendado; a IA vê o horário com o nome dela", async () => {
    const { mae, filha } = await maeEFilha();
    const r = await createVisit({ requestKey: randomUUID(), client: { contactId: filha }, dealId: mae.dealId, startsAt: bahia(16, 10).toISOString(),
      items: [{ serviceId: s.corte.id, professionalId: s.ana.id }] }, s.recepcao, NOW);
    const [a] = await db.select().from(appointments).where(eq(appointments.id, r.appointmentIds[0]));
    expect(a.contactId).toBe(filha);
    expect((await db.select().from(visits).where(eq(visits.id, r.visitId)))[0]).toMatchObject({ contactId: filha, dealId: mae.dealId, clientName: "Bruna Souza" });
    const [d] = await db.select().from(deals).where(eq(deals.id, mae.dealId!));
    expect(d.scheduledAt?.toISOString()).toBe(bahia(16, 10).toISOString());
    expect(await db.select().from(deals).where(eq(deals.contactId, filha))).toHaveLength(0);
    const conv = await loadConversation(mae.dealId!, NOW);
    expect(conv?.data.firstName).toBe("Marta");
    expect(conv?.data.nextAppointment).toMatchObject({ service: "Corte", forName: "Bruna" });
    expect(buildUser(conv!.data)).toContain("(o horário é de Bruna, que usa este mesmo número)");
  });

  it("conversa de outra cliente continua recusada", async () => {
    const { filha } = await maeEFilha();
    const outra = await cliente("Rita Lima", { stage: "atendimento" });
    await expect(createVisit({ requestKey: randomUUID(), client: { contactId: filha }, dealId: outra.dealId, startsAt: bahia(16, 10).toISOString(),
      items: [{ serviceId: s.corte.id, professionalId: s.ana.id }] }, s.recepcao, NOW)).rejects.toThrow("Conversa não encontrada");
  });
});

describe("painel da conversa: as pessoas do número com o próximo horário de cada uma (21/10, Cati: \"só uma aparece\")", () => {
  it("titular primeiro; cada pessoa com o próprio próximo horário (sem cancelado nem passado); só ela no número: sem consulta extra", async () => {
    const { mae, filha } = await maeEFilha();
    const base = { serviceLabel: "Corte", origin: "crm", professionalId: s.ana.id };
    await db.insert(appointments).values([
      { ...base, contactId: filha, startsAt: bahia(16, 14), status: "agendado", externalKey: "f1" },
      { ...base, contactId: filha, startsAt: bahia(20, 10), status: "confirmado", externalKey: "f2" },
      { ...base, contactId: filha, startsAt: bahia(15, 10), status: "cancelado", externalKey: "f3" },
      { ...base, contactId: mae.contactId, startsAt: bahia(14, 10), status: "compareceu", externalKey: "m1" },
    ]);
    const p = await numberPeopleWithNext(mae.contactId, NOW);
    expect(p?.people.map((x) => [x.name, x.isHolder, x.next?.startsAt ?? null])).toEqual([
      ["Marta Souza", true, null], ["Bruna Souza", false, bahia(16, 14).toISOString()],
    ]);
    expect(p?.people[1].next).toMatchObject({ serviceLabel: "Corte", professionalName: "Ana" });
    expect((await numberPeopleWithNext(filha, NOW))?.holderId).toBe(mae.contactId);
    const so = await cliente("Rita Lima");
    expect((await numberPeopleWithNext(so.contactId, NOW))?.people).toEqual([{ id: so.contactId, name: "Rita Lima", relation: null, isHolder: true, next: null }]);
  });
});
