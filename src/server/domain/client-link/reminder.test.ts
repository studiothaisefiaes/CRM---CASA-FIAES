import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, automations, channels, contacts, deals, lists, outbox, professionals, professionalServices, settings, stages, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { setWhatsappProvider } from "../../whatsapp/evolution";
import { drainOutbox } from "../outbox";
import { saveAutomation } from "../config";
import { cancelMany, changeStatus, reschedulePort } from "../agenda/ports";
import { DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT } from "./settings";
import { rescheduledDraft, runLembreteD1, saveLembreteD1 } from "./reminder";
import { rescheduleAppointment } from "../agenda/visits";
import { getVirada, saveVirada } from "../virada";
import { getLembreteD1 } from "./settings";
import { VIRADA_ITENS } from "@/lib/virada";
import { fazerVirada } from "../../../../test/virada";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = bahia("2026-10-14", "12:00"); // quarta
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
const LIGADO = { enabled: true, comLink: false, texto: DEFAULT_REMINDER_TEXT, textoRemarcado: DEFAULT_RESCHEDULED_TEXT };
// Provider falso: nenhum teste fala com a Evolution nem envia mensagem real.
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: `OUT${sent.length}` }; },
  sendPoll: async () => ({ externalId: "POLL" }),
};
const REMARCADO_17_15 = ["Oi, Paula! 💛", "", "Seu horário na Casa Fiaes foi remarcado para:", "", "📅 *sábado, 17/10* às *15:00*", "Corte com Maiara", "",
  "Se o novo horário não ficar bom para você, é só me avisar por aqui."].join("\n");
let g = "", maiara = "", bia = "", corte = "", escova = "", channelId = "";
let k = 0;

const cliente = async (name: string, phone: string, o: { deal?: "aberta" | "fechada" | "nenhuma"; ignored?: boolean } = {}) => {
  const [c] = await db.insert(contacts).values({ name, phoneE164: phone, ignored: o.ignored ?? false }).returning();
  if ((o.deal ?? "aberta") !== "nenhuma") {
    const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
    await db.insert(deals).values({ contactId: c.id, stageId: st.id, channelId, closedAt: o.deal === "fechada" ? bahia("2026-09-01", "10:00") : null });
  }
  return c.id;
};
const ap = async (contactId: string, startsAt: Date, o: Partial<typeof appointments.$inferInsert> = {}) =>
  (await db.insert(appointments).values({ contactId, clientName: "x", professionalId: maiara, serviceId: corte, serviceLabel: "Corte", startsAt, durationMin: 60,
    status: "agendado", origin: "avec", externalKey: `t:${++k}`, ...o }).returning())[0];
const queue = () => db.select().from(outbox);
/** Liga o lembrete como a tela da Virada: checklist feito, teste recente e a confirmação de envio real. */
const ligar = async (patch: Partial<typeof LIGADO> = {}) => { await fazerVirada("lembrete", g); return saveLembreteD1({ ...LIGADO, ...patch }, g, { confirmouEnvio: true }); };
const ofText = async (start: string) => (await queue()).filter((o) => o.text.startsWith(start));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  sent.length = 0;
  await resetDb();
  setWhatsappProvider(fake);
  await db.insert(settings).values([{ key: "business_hours", value: CASA }, { key: "agenda_modo", value: "dupla" }]);
  g = (await db.insert(users).values({ name: "Thaíse", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  [corte, escova] = (await db.insert(lists).values([{ kind: "service", label: "Corte (lembrete)", durationMin: 60 }, { kind: "service", label: "Escova (lembrete)", durationMin: 40 }]).returning()).map((r) => r.id);
  maiara = (await db.insert(professionals).values({ name: "MAIARA" }).returning())[0].id;
  bia = (await db.insert(professionals).values({ name: "BIA" }).returning())[0].id;
  await db.insert(professionalServices).values([{ professionalId: maiara, serviceId: corte }, { professionalId: bia, serviceId: escova }]);
  [{ id: channelId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
});
afterEach(() => { vi.useRealTimers(); setWhatsappProvider(null); });

describe("lembrete 24 h antes (pedido do dono, 15/10; DESLIGADO)", () => {
  it("desligado (o padrão) não faz nada", async () => {
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"));
    expect(await runLembreteD1(NOW)).toEqual({ enqueued: 0, skipped: 0 });
    expect(await queue()).toHaveLength(0);
  });

  it("pessoa a mais no número (filha no celular da mãe, 0051): sai pela conversa da mãe com o nome DA FILHA", async () => {
    await ligar();
    const mae = await cliente("Marta Souza", "+5571999990011");
    const { addPersonToNumber } = await import("../people-on-number");
    const { contactId: filha } = await addPersonToNumber({ contactId: mae, name: "Bruna Souza", relation: "filha" }, g);
    await ap(filha, bahia("2026-10-16", "10:00"));
    expect(await runLembreteD1(NOW)).toEqual({ enqueued: 1, skipped: 0 });
    const [o] = await queue();
    const [dealMae] = await db.select().from(deals).where(eq(deals.contactId, mae));
    expect(o.dealId).toBe(dealMae.id);
    expect(o.text.startsWith("Oi, Bruna!")).toBe(true);
    expect(await db.select().from(deals).where(eq(deals.contactId, filha))).toHaveLength(0);
  });

  it("agenda o envio 24 h antes, uma mensagem por visita, sem link por padrão, para todo horário com conversa (aberta ou não); não repete", async () => {
    await ligar();
    const paula = await cliente("Paula Souza", "+5571999990001");
    await ap(paula, bahia("2026-10-16", "10:00"));
    await ap(paula, bahia("2026-10-16", "11:00"), { serviceId: escova, serviceLabel: "Escova", professionalId: bia, durationMin: 40 });
    await ap(await cliente("Rita Lima", "+5571999990002", { deal: "fechada" }), bahia("2026-10-17", "14:00"), { status: "confirmado", confirmedAt: bahia("2026-10-10", "10:00") });
    await ap(await cliente("Fornecedor", "+5571999990003", { ignored: true }), bahia("2026-10-16", "15:00"));
    await ap(await cliente("Sem Conversa", "+5571999990005", { deal: "nenhuma" }), bahia("2026-10-16", "16:00"));
    await ap(await cliente("Cancelada", "+5571999990006"), bahia("2026-10-16", "17:00"), { status: "cancelado" });
    expect(await runLembreteD1(NOW)).toEqual({ enqueued: 2, skipped: 1 });
    const [p] = await ofText("Oi, Paula!");
    expect(p.text).toBe(["Oi, Paula! 💛", "", "Podemos confirmar sua presença amanhã na Casa Fiaes?", "", "📅 *sexta, 16/10* às *10:00*", "Corte com Maiara", "Escova com Bia", "",
      "Temos tolerância de 15 minutos. Se precisar remarcar, é só responder por aqui."].join("\n"));
    expect(p.notBefore.toISOString()).toBe(bahia("2026-10-15", "10:00").toISOString());
    expect(p.options).toMatchObject({ source: expect.stringMatching(/^lembrete_d1:/), visitStart: bahia("2026-10-16", "10:00").toISOString() });
    expect((await ofText("Oi, Rita!"))[0].notBefore.toISOString()).toBe(bahia("2026-10-16", "14:00").toISOString());
    expect(await runLembreteD1(NOW)).toEqual({ enqueued: 0, skipped: 3 });
    expect(await queue()).toHaveLength(2);
  });

  it("texto da Casa (Fase B): endereço da Página da cliente com o 📍 e o mapa (sem link do mapa, a busca do endereço no Maps)", async () => {
    await ligar();
    const { saveCasaInfo } = await import("./settings");
    await saveCasaInfo({ endereco: "Rua das Flores, 10 - Pituba", whatsapp: null }, g);
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"));
    await runLembreteD1(NOW);
    expect((await queue())[0].text).toContain("Corte com Maiara\n\n📍 Rua das Flores, 10 - Pituba\nhttps://www.google.com/maps/search/?api=1&query=Rua%20das%20Flores%2C%2010%20-%20Pituba\n\nTemos tolerância");
    await saveCasaInfo({ endereco: "Rua das Flores, 10 - Pituba", whatsapp: null, mapa: "https://maps.app.goo.gl/casa" }, g);
    const { reminderTextAtSend } = await import("./reminder");
    const [o] = await queue();
    expect(await reminderTextAtSend((o.options as { source: string }).source, o.text, NOW)).toContain("📍 Rua das Flores, 10 - Pituba\nhttps://maps.app.goo.gl/casa\n\n");
  });

  it("com o link ligado (comLink), a frase do link vai no fim", async () => {
    await ligar({ comLink: true });
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"));
    await runLembreteD1(NOW);
    expect((await queue())[0].text).toMatch(/\n\nSe quiser, confirme ou remarque por aqui: http\S+\/c\/[2-9A-HJ-NP-Za-km-z]{8}$/);
  });

  it("janela 8h–20h: horário às 07:00 tem o lembrete às 08:00 da véspera", async () => {
    await ligar();
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "07:00"));
    await runLembreteD1(NOW);
    expect((await queue())[0].notBefore.toISOString()).toBe(bahia("2026-10-15", "08:00").toISOString());
  });

  it("na hora de enviar: sai se nada mudou (mesmo com a Casa fechada, dentro da janela); cancelado e confirmado há menos de 24 h não recebem", async () => {
    await ligar();
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-20", "10:00")); // terça: o lembrete sai na segunda, com a Casa fechada
    const rita = await ap(await cliente("Rita Lima", "+5571999990002"), bahia("2026-10-20", "11:00"));
    const bea = await ap(await cliente("Bea Lima", "+5571999990003"), bahia("2026-10-20", "14:00"));
    vi.setSystemTime(bahia("2026-10-19", "09:00"));
    await runLembreteD1(bahia("2026-10-19", "09:00"));
    await changeStatus({ appointmentId: rita.id, status: "confirmado", actorId: g, via: "recepcao" });
    await cancelMany({ appointmentIds: [bea.id], reason: "cliente_desmarcou", note: null, actorId: g, via: "recepcao" });
    vi.setSystemTime(bahia("2026-10-19", "14:00"));
    await drainOutbox(bahia("2026-10-19", "14:00"));
    const of = async (n: string) => (await ofText(`Oi, ${n}!`))[0];
    expect(await of("Paula")).toMatchObject({ status: "sent" });
    expect(await of("Rita")).toMatchObject({ status: "cancelled", error: "A cliente confirmou há pouco." });
    expect(await of("Bea")).toMatchObject({ status: "cancelled", error: "O horário foi cancelado." });
    expect(sent).toHaveLength(1);
  });

  it("fora da janela (21h), o lembrete espera, mesmo vencido", async () => {
    await ligar();
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"));
    await runLembreteD1(NOW);
    expect((await drainOutbox(bahia("2026-10-15", "21:00"))).sent).toBe(0);
  });

  it("remarcar: sai na hora a mensagem de remarcado e o lembrete vai para o horário novo (o antigo é cancelado)", async () => {
    await ligar();
    const a = await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"), { origin: "crm" });
    await runLembreteD1(NOW);
    await reschedulePort({ appointmentId: a.id, startsAt: bahia("2026-10-17", "15:00"), professionalId: maiara, actorId: g });
    const rows = await queue();
    const old = rows.find((r) => (r.options as { visitStart?: string }).visitStart === bahia("2026-10-16", "10:00").toISOString());
    expect(old).toMatchObject({ status: "cancelled", error: "O horário mudou." });
    const novo = rows.find((r) => r.status === "pending" && (r.options as { source?: string }).source?.startsWith("lembrete_d1:"));
    expect(novo?.notBefore.toISOString()).toBe(bahia("2026-10-16", "15:00").toISOString());
    const [rem] = rows.filter((r) => (r.options as { source?: string }).source?.startsWith("lembrete_d1_remarcado:"));
    expect(rem.text).toBe(REMARCADO_17_15);
    expect(rem.notBefore.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(await runLembreteD1(NOW)).toEqual({ enqueued: 0, skipped: 1 });
  });

  it("Agenda › mover (16/10): sem 'Avisar a cliente' nada sai sozinho, mas o lembrete vai para o horário novo", async () => {
    await ligar();
    const a = await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"), { origin: "crm" });
    await rescheduleAppointment(a.id, { startsAt: bahia("2026-10-17", "15:00").toISOString(), professionalId: maiara }, { id: g, perms: ["agenda.marcar"] }, NOW, { clientMessage: false });
    const rows = await queue();
    expect(rows.filter((r) => (r.options as { source?: string }).source?.startsWith("lembrete_d1_remarcado:"))).toHaveLength(0);
    expect(rows.find((r) => r.status === "pending" && (r.options as { source?: string }).source?.startsWith("lembrete_d1:"))?.notBefore.toISOString()).toBe(bahia("2026-10-16", "15:00").toISOString());
  });

  it("Agenda › mover com 'Avisar a cliente': só o texto e a conversa (nada vai para a fila), mesmo com o lembrete desligado", async () => {
    const a = await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-17", "15:00"), { origin: "crm" });
    const [deal] = await db.select().from(deals);
    expect(await rescheduledDraft(a.id, NOW)).toEqual({ dealId: deal.id, text: REMARCADO_17_15 });
    expect(await queue()).toHaveLength(0);
    const sem = await ap(await cliente("Rita Sem Conversa", "+5571999990002", { deal: "nenhuma" }), bahia("2026-10-17", "16:00"));
    expect(await rescheduledDraft(sem.id, NOW)).toBeNull();
  });

  it("desligar depois de enfileirar: a fila cancela na hora de enviar", async () => {
    await ligar();
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"));
    await runLembreteD1(NOW);
    await saveLembreteD1({ ...LIGADO, enabled: false }, g);
    await drainOutbox(bahia("2026-10-15", "10:00"));
    expect((await queue())[0]).toMatchObject({ status: "cancelled", error: "O lembrete foi desligado." });
    expect(sent).toHaveLength(0);
  });

  it("não liga com o lembrete ou a enquete das automações ligado, e elas não ligam com ele ligado (a mesma trava)", async () => {
    await saveAutomation(null, { name: "Lembrete", enabled: true, trigger: { type: "agendamento_em_horas", hours: 24 }, conditions: [], actions: [{ type: "enviar_mensagem", message: "Oi, {nome}!" }] }, g, { confirmouEnvio: true });
    await expect(ligar()).rejects.toThrow("Desligue antes o lembrete ou a enquete de agendamento das Automações");
    await db.update(automations).set({ enabled: false });
    await ligar();
    await expect(saveAutomation(null, { name: "Enquete", enabled: true, trigger: { type: "agendamento_em_horas", hours: 24 }, conditions: [], actions: [{ type: "enviar_enquete_confirmacao", message: "Confirma?" }] }, g, { confirmouEnvio: true }))
      .rejects.toThrow("Desligue o lembrete do horário (no fim desta tela)");
  });

  describe("só na véspera (17/10: 16 lembretes saíram às 8h do próprio dia dizendo 'amanhã')", () => {
    it("o momento de 24 h antes já passou: não enfileira (nem para hoje, nem para amanhã cedo)", async () => {
      await ligar();
      await ap(await cliente("Hoje Tarde", "+5571999990001"), bahia("2026-10-14", "18:00")); // hoje: 24 h antes foi ontem
      await ap(await cliente("Amanha Cedo", "+5571999990002"), bahia("2026-10-15", "09:00")); // amanhã 9h: o envio seria hoje 9h, já passou
      expect(await runLembreteD1(NOW)).toEqual({ enqueued: 0, skipped: 2 });
      expect(await queue()).toHaveLength(0);
    });

    it("o job da noite não enfileira para sair no dia seguinte (o caso real: horário 09:00, job às 22:00 da véspera)", async () => {
      await ligar();
      await ap(await cliente("Cristiana Souza", "+5571999990001"), bahia("2026-10-17", "09:00"));
      const noite = bahia("2026-10-16", "22:00");
      vi.setSystemTime(noite);
      expect(await runLembreteD1(noite)).toEqual({ enqueued: 0, skipped: 1 });
      expect(await queue()).toHaveLength(0);
    });

    it("tolerância de poucos minutos (o job roda a cada 15 min): passou há 10 min, ainda sai agora", async () => {
      await ligar();
      await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-15", "11:50"));
      expect(await runLembreteD1(NOW)).toEqual({ enqueued: 1, skipped: 0 });
      expect((await queue())[0].notBefore.toISOString()).toBe(NOW.toISOString());
    });

    it("na hora de enviar: se hoje já não é a véspera, cancela com o motivo", async () => {
      await ligar();
      await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-15", "15:00"));
      await runLembreteD1(NOW); // sai hoje às 15:00
      const dia = bahia("2026-10-15", "08:00"); // a fila não enviou na véspera (parada); no dia do horário, não sai mais
      vi.setSystemTime(dia);
      await drainOutbox(dia);
      expect((await queue())[0]).toMatchObject({ status: "cancelled", error: "Já não é a véspera do horário." });
      expect(sent).toHaveLength(0);
    });
  });

  describe("o texto lista a visita inteira na hora de enviar (17/10: Cristiana recebeu só um dos dois serviços)", () => {
    it("serviço que entrou na visita depois de enfileirar (Avec importou depois, sem visita): o texto sai com os dois", async () => {
      await ligar();
      const cris = await cliente("Cristiana Souza", "+5571999990001");
      await ap(cris, bahia("2026-10-16", "09:00"), { serviceLabel: "Coloração ou Tonalização", professionalId: bia, serviceId: escova });
      await runLembreteD1(NOW);
      expect((await queue())[0].text).not.toContain("Luzes");
      await ap(cris, bahia("2026-10-16", "09:00"), { serviceLabel: "Luzes e Mechas" }); // com a Maiara, ainda sem visita
      const hora = bahia("2026-10-15", "09:00");
      vi.setSystemTime(hora);
      await drainOutbox(hora);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("Luzes e Mechas com Maiara");
      expect(sent[0]).toContain("Coloração ou Tonalização com Bia");
      expect((await queue())[0]).toMatchObject({ status: "sent", text: sent[0] });
    });

    it("serviço cancelado depois de enfileirar sai do texto; o link do texto é o mesmo de quando entrou na fila", async () => {
      await ligar({ comLink: true });
      const paula = await cliente("Paula Souza", "+5571999990001");
      await ap(paula, bahia("2026-10-16", "10:00"));
      const escovaAp = await ap(paula, bahia("2026-10-16", "11:00"), { serviceId: escova, serviceLabel: "Escova", professionalId: bia, durationMin: 40 });
      await runLembreteD1(NOW);
      const link = (await queue())[0].text.match(/http\S+\/c\/\S{8}/)?.[0];
      expect(link).toBeTruthy();
      await cancelMany({ appointmentIds: [escovaAp.id], reason: "cliente_desmarcou", note: null, actorId: g, via: "recepcao" });
      const hora = bahia("2026-10-15", "10:00");
      vi.setSystemTime(hora);
      await drainOutbox(hora);
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toContain("Escova");
      expect(sent[0]).toContain("Corte com Maiara");
      expect(sent[0]).toContain(link!);
    });
  });

  it("assistente (17/10): para a cliente quem atende é a principal, e os serviços dela vão numa frase só", async () => {
    await ligar();
    await db.update(professionals).set({ name: "THAISE" }).where(eq(professionals.id, maiara));
    await db.update(professionals).set({ name: "SIDNEY", assistantOf: maiara }).where(eq(professionals.id, bia));
    const cris = await cliente("Cristiana Souza", "+5571999990001");
    await ap(cris, bahia("2026-10-16", "09:00"), { serviceLabel: "Luzes e Mechas" });
    await ap(cris, bahia("2026-10-16", "09:00"), { serviceLabel: "Coloração ou Tonalização", professionalId: bia, serviceId: escova });
    await runLembreteD1(NOW);
    const [o] = await queue();
    expect(o.text).toContain("\nLuzes e Mechas e Coloração ou Tonalização com Thaise\n");
    expect(o.text).not.toContain("Sidney");
  });

  describe("análise de 17/10", () => {
    it("lembrete cancelado (ex.: desligado) não impede refazer quando religa", async () => {
      await ligar();
      await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"));
      await runLembreteD1(NOW);
      await saveLembreteD1({ ...LIGADO, enabled: false }, g);
      await drainOutbox(bahia("2026-10-15", "10:00")); // cancela: "O lembrete foi desligado."
      await ligar();
      expect(await runLembreteD1(NOW)).toEqual({ enqueued: 1, skipped: 0 });
      expect((await queue()).map((o) => o.status).sort()).toEqual(["cancelled", "pending"]);
    });

    it("cliente que já chegou para um serviço da visita não recebe lembrete (Thamires, 08:46, já no salão)", async () => {
      await ligar();
      const tha = await cliente("Thamires Domingues", "+5571999990001");
      const a = await ap(tha, bahia("2026-10-15", "09:00"));
      await ap(tha, bahia("2026-10-15", "17:30"), { serviceLabel: "Finalização", status: "confirmado" });
      const cedo = bahia("2026-10-14", "08:00");
      vi.setSystemTime(cedo);
      await runLembreteD1(cedo); // véspera 9h: enfileira
      await db.update(appointments).set({ status: "chegou" }).where(eq(appointments.id, a.id));
      const dia = bahia("2026-10-14", "08:46");
      vi.setSystemTime(dia);
      expect(await runLembreteD1(dia)).toMatchObject({ enqueued: 0 }); // o "início" não vira o das 17:30
      await drainOutbox(bahia("2026-10-14", "09:00"));
      expect((await queue())[0]).toMatchObject({ status: "cancelled", error: "A cliente já está na Casa ou já foi atendida." });
      expect(await queue()).toHaveLength(1);
      expect(sent).toHaveLength(0);
    });

    it("texto sem 'Não informado' e sem serviço repetido", async () => {
      await ligar();
      const p = await cliente("Paula Souza", "+5571999990001");
      await ap(p, bahia("2026-10-16", "10:00"), { serviceLabel: "Não informado", serviceId: null });
      await ap(p, bahia("2026-10-16", "10:00"), { serviceLabel: "Escova", professionalId: bia, serviceId: escova });
      await ap(p, bahia("2026-10-16", "10:00"), { serviceLabel: "Escova", professionalId: bia, serviceId: escova });
      await runLembreteD1(NOW);
      const [o] = await queue();
      expect(o.text).not.toContain("Não informado");
      expect(o.text).toContain("\nAtendimento com Maiara\nEscova com Bia\n");
    });
  });
});


describe("Virada (Task 10): o lembrete só liga com o ChatGuru e o Avec desligados, o texto conferido e o teste recebido", () => {
  const cfg = LIGADO;
  const uid = () => g;
  it("ligar o lembrete sem a virada é recusado; com os 4 itens marcados, liga", async () => {
    await expect(saveLembreteD1({ ...cfg, enabled: true }, uid(), { confirmouEnvio: true })).rejects.toThrow("Faça a troca do ChatGuru para o CRM antes de ligar: confirme que o lembrete do ChatGuru e a confirmação do Avec estão desligados.");
    await db.insert(auditLog).values({ userId: g, action: "teste_virada", entity: "virada", entityId: "lembrete", data: {}, createdAt: NOW });
    await saveVirada("lembrete", ["chatguru_lembrete", "avec_confirmacao", "texto_conferido"], uid());
    await expect(saveLembreteD1({ ...cfg, enabled: true }, uid(), { confirmouEnvio: true })).rejects.toThrow("Faça a troca do ChatGuru para o CRM antes de ligar");
    expect((await getLembreteD1()).enabled).toBe(false);
    await saveVirada("lembrete", [...VIRADA_ITENS.lembrete], uid());
    await expect(saveLembreteD1({ ...cfg, enabled: true }, uid(), { confirmouEnvio: true })).resolves.toBeUndefined();
    expect((await getLembreteD1()).enabled).toBe(true);
  });

  it("com a virada feita, ligar sem a confirmação de envio real é recusado no servidor", async () => {
    await fazerVirada("lembrete", g);
    await expect(saveLembreteD1({ ...cfg, enabled: true }, uid())).rejects.toThrow("Confirme o envio real para ligar.");
    expect((await getLembreteD1()).enabled).toBe(false);
  });

  it("teste_enviado só conta se o teste é das últimas 24 h na hora de ligar", async () => {
    await fazerVirada("lembrete", g);
    vi.setSystemTime(new Date(NOW.getTime() + 25 * 3_600_000));
    await expect(saveLembreteD1({ ...cfg, enabled: true }, uid(), { confirmouEnvio: true })).rejects.toThrow("Mande o teste");
    expect((await getLembreteD1()).enabled).toBe(false);
  });

  it("desligar não pede virada, e o que estava na fila é cancelado na hora de enviar; ligar de novo pede a Virada outra vez", async () => {
    await ligar();
    await ap(await cliente("Paula Souza", "+5571999990001"), bahia("2026-10-16", "10:00"));
    await runLembreteD1(NOW);
    await saveVirada("lembrete", [], g); // nem o checklist desfeito impede desligar
    await expect(saveLembreteD1({ ...cfg, enabled: false }, uid())).resolves.toBeUndefined();
    await drainOutbox(bahia("2026-10-15", "10:00"));
    expect((await queue())[0]).toMatchObject({ status: "cancelled", error: "O lembrete foi desligado." });
    expect(sent).toHaveLength(0);
    await ligar();
    await saveLembreteD1({ ...cfg, enabled: false }, uid());
    // Desligou (voltar atrás = religar o do ChatGuru): o checklist volta a zero.
    expect((await getVirada("lembrete"))?.marcados).toEqual([]);
    await expect(saveLembreteD1({ ...cfg, enabled: true }, uid(), { confirmouEnvio: true })).rejects.toThrow("Faça a troca do ChatGuru para o CRM antes de ligar");
  });

  it("editar o texto com o lembrete ligado não pede o teste nem a confirmação de novo (só o checklist completo)", async () => {
    await ligar();
    vi.setSystemTime(new Date(NOW.getTime() + 48 * 3_600_000));
    await expect(saveLembreteD1({ ...cfg, texto: `${cfg.texto}\nBeijos!` }, uid())).resolves.toBeUndefined();
    expect((await getLembreteD1()).texto.endsWith("Beijos!")).toBe(true);
  });
});
