import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { agendaBlocks, appointmentAssistants, appointments, auditLog, comandaItemAssistants, comandaItems, lists, professionals, professionalServices } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ALL_DAYS, ap, bahia, cliente, NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { getAgenda } from "../../queries/agenda";
import { agendaRange } from "@/lib/agenda";
import { cancelAppointments, createVisit, rescheduleAppointment, type CreateVisitInput } from "./visits";
import { previewAuxiliaries } from "./appointment-assistants";
import { dayRulesFor } from "./availability";
import { openComandaForAppointment } from "../caixa/comandas";
import { saveFuncoes } from "../funcoes";

let s: Awaited<ReturnType<typeof setupCaixa>>;
let sidney: { id: string }; let roberta: { id: string }; let carla: { id: string };
beforeEach(async () => {
  await resetDb(); s = await setupCaixa({ estoque: false });
  [sidney, roberta, carla] = await db.insert(professionals).values([
    { name: "Sidney", fullName: "Sidney Souza", assistantOf: s.ana.id, agendaPosition: 3, workHours: ALL_DAYS },
    { name: "Roberta", fullName: "Roberta Lima", assistantOf: s.ana.id, agendaPosition: 4, workHours: ALL_DAYS },
    { name: "Carla", fullName: "Carla Dias", agendaPosition: 5, workHours: ALL_DAYS },
  ]).returning();
});

const at10 = bahia(16, 10).toISOString();
const book = (contactId: string, over: Partial<CreateVisitInput> = {}, assistantIds: string[] = [sidney.id]): CreateVisitInput => ({
  requestKey: randomUUID(), client: { contactId }, startsAt: at10, items: [{ serviceId: s.corte.id, professionalId: s.ana.id, assistantIds }], ...over,
});
const auxOf = async (appointmentId: string) => (await db.select().from(appointmentAssistants).where(eq(appointmentAssistants.appointmentId, appointmentId)).orderBy(asc(appointmentAssistants.position)))
  .map((a) => [a.professionalId, a.position]);
const later = bahia(15, 9, 10); // 10 min depois de NOW: não é mais "acabou de ser ocupado"

describe("auxiliares no horário", () => {
  it("grava as auxiliares na ordem escolhida, com rastro", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, {}, [roberta.id, sidney.id]), s.recepcao, NOW);
    expect(await auxOf(r.appointmentIds[0])).toEqual([[roberta.id, 1], [sidney.id, 2]]);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, r.appointmentIds[0]), eq(auditLog.action, "agendamento_marcado")));
    expect(log.data).toMatchObject({ auxiliares: [roberta.id, sidney.id] });
  });

  it("a auxiliar ocupa a agenda dela: quem tenta marcar com ela no mesmo período vê o conflito", async () => {
    const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
    await createVisit(book(p.contactId), s.recepcao, NOW);
    const rules = await dayRulesFor({ professionalId: sidney.id, day: "2026-10-16" });
    expect(rules.busy.map((b) => [b.start, b.end])).toEqual([[600, 660]]);
    // Sidney como principal (ela faz Corte)
    await db.insert(professionalServices).values({ professionalId: sidney.id, serviceId: s.corte.id });
    await expect(createVisit(book(q.contactId, { startsAt: bahia(16, 10, 30).toISOString(), items: [{ serviceId: s.corte.id, professionalId: sidney.id }] }), s.recepcao, later))
      .rejects.toThrow("Sidney já tem Paula das 10:00 às 11:00");
    // Sidney como auxiliar de outra: aviso claro, com quem é
    await expect(createVisit(book(q.contactId, { startsAt: bahia(16, 10, 30).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.bia.id, assistantIds: [sidney.id] }] }), s.recepcao, later))
      .rejects.toThrow("A auxiliar Sidney não está livre: Sidney já tem Paula das 10:00 às 11:00.");
  });

  it("conflito da auxiliar: só com 'Encaixar mesmo assim' e a permissão; bloqueio nunca passa", async () => {
    const p = await cliente("Paula Souza");
    await ap({ startsAt: bahia(16, 10), professionalId: sidney.id, clientName: "Maria Avec" });
    await expect(createVisit(book(p.contactId), s.recepcao, NOW)).rejects.toThrow("A auxiliar Sidney não está livre: Sidney já tem Maria das 10:00 às 11:00.");
    await expect(createVisit(book(p.contactId, { fitIn: true }), s.semEncaixe, NOW)).rejects.toThrow(/A auxiliar Sidney não está livre/);
    const r = await createVisit(book(p.contactId, { fitIn: true }), s.recepcao, NOW);
    expect((await db.select().from(appointments).where(eq(appointments.id, r.appointmentIds[0])))[0]).toMatchObject({ fitIn: true, fitInBy: s.cati.id });
    await db.insert(agendaBlocks).values({ professionalId: roberta.id, title: "Curso", startsOn: "2026-10-16", endsOn: "2026-10-16", startTime: "14:00", endTime: "16:00", externalKey: "crm:blq:aux", origin: "crm", reason: "curso" });
    const q = await cliente("Joana Lima");
    await expect(createVisit(book(q.contactId, { startsAt: bahia(16, 14).toISOString(), fitIn: true }, [roberta.id]), s.recepcao, NOW))
      .rejects.toThrow("A auxiliar Roberta não está livre: Roberta está com a agenda bloqueada nesse horário (Curso).");
  });

  it("a principal não é auxiliar do próprio serviço, ninguém repete e ninguém fica em dois serviços ao mesmo tempo na visita", async () => {
    const p = await cliente("Paula Souza");
    await expect(createVisit(book(p.contactId, {}, [s.ana.id]), s.recepcao, NOW)).rejects.toThrow("Ana é quem atende este serviço; não pode ser auxiliar dele também.");
    await expect(createVisit(book(p.contactId, {}, [sidney.id, sidney.id]), s.recepcao, NOW)).rejects.toThrow("A mesma auxiliar não pode entrar duas vezes no serviço.");
    await expect(createVisit(book(p.contactId, { items: [
      { serviceId: s.corte.id, professionalId: s.ana.id, assistantIds: [s.bia.id] },
      { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "junto" },
    ] }), s.recepcao, NOW)).rejects.toThrow("Bia não pode estar em dois serviços ao mesmo tempo nesta visita.");
    // "Logo depois" não se cruza: a auxiliar do Corte faz a Hidratação em seguida.
    const r = await createVisit(book(p.contactId, { items: [
      { serviceId: s.corte.id, professionalId: s.ana.id, assistantIds: [s.bia.id] },
      { serviceId: s.hidratacao.id, professionalId: s.bia.id, mode: "depois" },
    ] }), s.recepcao, NOW);
    expect(await auxOf(r.appointmentIds[0])).toEqual([[s.bia.id, 1]]);
  });

  it("'Qualquer uma' nunca escolhe a auxiliar do próprio serviço para atender", async () => {
    const p = await cliente("Paula Souza");
    // Ana já está ocupada às 10h; sobram Bia (auxiliar) e ninguém mais
    await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, clientName: "Maria Avec" });
    await expect(createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: null, assistantIds: [s.bia.id] }] }), s.recepcao, NOW))
      .rejects.toThrow("Ninguém que faz Corte está livre às 10:00");
  });

  it("remarcar leva as auxiliares junto (a agenda delas é conferida no novo horário) e dá para trocar as auxiliares", async () => {
    const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    const id = r.appointmentIds[0];
    await rescheduleAppointment(id, { startsAt: bahia(16, 14).toISOString() }, s.recepcao, NOW);
    expect(await auxOf(id)).toEqual([[sidney.id, 1]]);
    expect((await dayRulesFor({ professionalId: sidney.id, day: "2026-10-16" })).busy.map((b) => b.start)).toEqual([840]);
    // Sidney ocupada às 16h: remarcar para lá é recusado com o nome dela
    await ap({ startsAt: bahia(16, 16), professionalId: sidney.id, clientName: "Maria Avec" });
    await expect(rescheduleAppointment(id, { startsAt: bahia(16, 16).toISOString() }, s.recepcao, later)).rejects.toThrow("A auxiliar Sidney não está livre: Sidney já tem Maria das 16:00 às 17:00.");
    // trocando a auxiliar, passa e fica no rastro
    await rescheduleAppointment(id, { startsAt: bahia(16, 16).toISOString(), assistantIds: [roberta.id] }, s.recepcao, later);
    expect(await auxOf(id)).toEqual([[roberta.id, 1]]);
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "agendamento_remarcado"))).orderBy(asc(auditLog.createdAt)).offset(1);
    expect(log.data).toMatchObject({ de: { auxiliares: [sidney.id] }, para: { auxiliares: [roberta.id] } });
    // passar o horário para a própria auxiliar é recusado
    await db.insert(professionalServices).values({ professionalId: roberta.id, serviceId: s.corte.id });
    await expect(rescheduleAppointment(id, { startsAt: bahia(16, 16).toISOString(), professionalId: roberta.id, confirmProChange: true }, s.recepcao, later))
      .rejects.toThrow("Roberta é quem atende este serviço; não pode ser auxiliar dele também.");
    // o horário antigo de Sidney ficou livre
    await expect(createVisit(book(q.contactId, { startsAt: bahia(16, 10).toISOString() }), s.recepcao, later)).resolves.toBeTruthy();
  });

  it("cancelar libera a agenda das auxiliares", async () => {
    const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
    const r = await createVisit(book(p.contactId), s.recepcao, NOW);
    await expect(createVisit(book(q.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.bia.id, assistantIds: [sidney.id] }] }), s.recepcao, later)).rejects.toThrow(/A auxiliar Sidney/);
    await cancelAppointments({ appointmentId: r.appointmentIds[0], reason: "cliente_desmarcou" }, s.recepcao, later);
    expect((await dayRulesFor({ professionalId: sidney.id, day: "2026-10-16" })).busy).toEqual([]);
    const r2 = await createVisit(book(q.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.bia.id, assistantIds: [sidney.id] }] }), s.recepcao, later);
    expect(await auxOf(r2.appointmentIds[0])).toEqual([[sidney.id, 1]]);
  });

  it("a Agenda traz as auxiliares de cada horário (a grade mostra na coluna delas com o selo)", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, {}, [roberta.id, sidney.id]), s.recepcao, NOW);
    const items = await getAgenda(agendaRange({ d: "2026-10-16" }, NOW), NOW);
    expect(items.find((i) => i.appointmentId === r.appointmentIds[0])?.assistants).toEqual([{ id: roberta.id, name: "Roberta" }, { id: sidney.id, name: "Sidney" }]);
  });

  it("prévia da folha: livre, conflito e bloqueio de cada auxiliar", async () => {
    await ap({ startsAt: bahia(16, 10), professionalId: sidney.id, clientName: "Maria Avec" });
    await db.insert(agendaBlocks).values({ professionalId: roberta.id, title: "Almoço", startsOn: "2026-10-16", endsOn: "2026-10-16", startTime: "10:00", endTime: "11:00", externalKey: "crm:blq:aux2", origin: "crm", reason: "almoco" });
    const r = await previewAuxiliaries({ assistantIds: [sidney.id, roberta.id, carla.id], startsAt: at10, durationMin: 60, serviceId: s.corte.id }, NOW);
    expect(r.map((x) => [x.name, x.state, x.text])).toEqual([
      ["Sidney", "encaixe", "A auxiliar Sidney não está livre: Sidney já tem Maria das 10:00 às 11:00."],
      ["Roberta", "recusado", "A auxiliar Roberta não está livre: Roberta está com a agenda bloqueada nesse horário (Almoço)."],
      ["Carla", "livre", "Carla livre"],
    ]);
  });
});

describe("duração na folha", () => {
  it("a duração digitada vale desta vez; 'guardar como padrão' grava o tempo da profissional (função ligada) ou o do serviço", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id, durationMin: 90 }] }), s.recepcao, NOW);
    expect((await db.select().from(appointments).where(eq(appointments.id, r.appointmentIds[0])))[0].durationMin).toBe(90);
    await expect(createVisit(book(p.contactId, { startsAt: bahia(16, 14).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, durationMin: 33 }] }), s.recepcao, NOW))
      .rejects.toThrow("Confira a duração");
    await createVisit(book(p.contactId, { startsAt: bahia(16, 14).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, durationMin: 75, saveDuration: true }] }), s.gestao, NOW);
    const [own] = await db.select().from(professionalServices).where(and(eq(professionalServices.professionalId, s.ana.id), eq(professionalServices.serviceId, s.corte.id)));
    expect(own.durationMin).toBe(75);
    expect((await db.select().from(lists).where(eq(lists.id, s.corte.id)))[0].durationMin).toBe(60); // o serviço não muda
    // Função desligada: o tempo é um só, então vira a duração do serviço.
    await saveFuncoes({ preco_por_profissional: false }, s.gestora.id);
    await createVisit(book(p.contactId, { startsAt: bahia(16, 16).toISOString(), items: [{ serviceId: s.hidratacao.id, professionalId: s.ana.id, durationMin: 50, saveDuration: true }] }), s.gestao, NOW);
    expect((await db.select().from(lists).where(eq(lists.id, s.hidratacao.id)))[0].durationMin).toBe(50);
  });
});

describe("comanda recebe as auxiliares", () => {
  it("Chegou/abrir comanda: as auxiliares viram as assistentes do item, na ordem do horário", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { startsAt: bahia(15, 10).toISOString() }, [sidney.id, carla.id]), s.recepcao, NOW);
    const c = await openComandaForAppointment(r.appointmentIds[0], s.caixaRecepcao, NOW);
    expect(c.warnings).toBeUndefined();
    const [item] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c.comandaId));
    expect((await db.select().from(comandaItemAssistants).where(eq(comandaItemAssistants.comandaItemId, item.id)).orderBy(asc(comandaItemAssistants.position))).map((a) => [a.professionalId, a.position]))
      .toEqual([[sidney.id, 1], [carla.id, 2]]); // Carla não é assistente fixa da Ana: vale a escolha do horário, não a sugestão
  });

  it("mais auxiliares que o limite do Caixa: entram as primeiras e a comanda avisa quem ficou de fora", async () => {
    await setSetting("caixa_recursos", { assistentes: true, assistentesMax: 1 });
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { startsAt: bahia(15, 10).toISOString() }, [sidney.id, roberta.id, carla.id]), s.recepcao, NOW);
    const c = await openComandaForAppointment(r.appointmentIds[0], s.caixaRecepcao, NOW);
    expect(c.warnings).toEqual(["Corte: A comanda aceita até 1 assistente por serviço: Roberta, Carla ficou de fora (só na agenda)."]);
    const [item] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c.comandaId));
    expect((await db.select().from(comandaItemAssistants).where(eq(comandaItemAssistants.comandaItemId, item.id))).map((a) => a.professionalId)).toEqual([sidney.id]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "assistente_de_fora"))).toHaveLength(1);
  });

  it("horário sem auxiliares segue com as assistentes fixas da profissional (como antes)", async () => {
    const p = await cliente("Paula Souza");
    const r = await createVisit(book(p.contactId, { startsAt: bahia(15, 10).toISOString() }, []), s.recepcao, NOW);
    const c = await openComandaForAppointment(r.appointmentIds[0], s.caixaRecepcao, NOW);
    const [item] = await db.select().from(comandaItems).where(eq(comandaItems.comandaId, c.comandaId));
    expect((await db.select().from(comandaItemAssistants).where(eq(comandaItemAssistants.comandaItemId, item.id))).map((a) => a.professionalId).sort()).toEqual([roberta.id, sidney.id].sort());
  });
});
