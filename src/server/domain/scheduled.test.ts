import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, deals, messages, outbox, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { drainOutbox } from "./outbox";
import { cancelScheduled, scheduleMessage, scheduledOf, sendScheduledNow } from "./scheduled";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN }; // Lote 0: ter–sáb 9h–18h
// Datas no passado: o registro da resposta usa o relógio de verdade e trata como "atrasada" a mensagem mais velha que a espera.
const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10:00 em Salvador
const AT = new Date("2026-10-14T13:00:00Z"); // quarta 10:00
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const sent: string[] = []; let failSend = false;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { if (failSend) throw new ProviderError("Evolution recusou", 500); sent.push(text); return { externalId: `OUT${sent.length}` }; },
};
let sara = "", dealId = "", contactId = "";

beforeEach(async () => {
  sent.length = 0; failSend = false;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x", signature: "SARA" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999990021", pushName: "Cliente Teste", body: "Oi! Amanhã confirmo", at: plus(T0, -5), now: plus(T0, -5) });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

const failAlert = async () => (await db.select().from(alerts).where(eq(alerts.type, "agendada_falhou")))[0];

describe("mensagem agendada", () => {
  it("agenda: fica na fila com a hora e quem agendou, e aparece na conversa", async () => {
    const { id } = await scheduleMessage({ dealId, text: "Confirma amanhã às 15h?", at: AT, cancelIfReply: false }, sara, T0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ id, createdBy: sara, notBefore: AT, status: "pending", options: { source: "agendada", cancelIfReply: false, sendAt: AT.toISOString() } });
    expect(await scheduledOf(contactId)).toEqual([expect.objectContaining({ id, text: "Confirma amanhã às 15h?", authorName: "Sara Lima", cancelIfReply: false })]);
  });

  it("Casa fechada: a mensagem programada pela atendente é aceita e sai na hora marcada (16/10)", async () => {
    expect((await scheduleMessage({ dealId, text: "x", at: new Date("2026-10-26T13:00:00Z") }, sara, T0)).at).toEqual(new Date("2026-10-26T13:00:00Z"));
  });
  it("recusa: menos de 5 min, mais de 60 dias, texto vazio e mais de 5 na mesma conversa", async () => {
    await expect(scheduleMessage({ dealId, text: "   ", at: AT }, sara, T0)).rejects.toThrow(/Escreva a mensagem/);
    await expect(scheduleMessage({ dealId, text: "x", at: plus(T0, 3) }, sara, T0)).rejects.toThrow(/pelo menos 5 minutos/);
    await expect(scheduleMessage({ dealId, text: "x", at: new Date("2026-12-30T13:00:00Z") }, sara, T0)).rejects.toThrow(/até 60 dias/);
    for (let i = 0; i < 5; i++) await scheduleMessage({ dealId, text: `m${i}`, at: plus(AT, i * 10) }, sara, T0);
    await expect(scheduleMessage({ dealId, text: "m6", at: AT }, sara, T0)).rejects.toThrow(/já tem 5 mensagens agendadas/);
  });

  it("antes da hora não sai; na hora sai assinada por quem agendou e conta como resposta dela", async () => {
    await scheduleMessage({ dealId, text: "Confirma amanhã às 15h?", at: AT }, sara, T0);
    expect((await drainOutbox(plus(AT, -1))).sent).toBe(0);
    expect((await drainOutbox(AT)).sent).toBe(1);
    expect(sent[0].startsWith("*SARA - CASA FIAES:*")).toBe(true);
    expect(sent[0]).toContain("Confirma amanhã às 15h?");
    const out = (await db.select().from(messages)).find((m) => m.direction === "out")!;
    expect(out).toMatchObject({ sentByUserId: sara, sentVia: "crm", status: "sent", dealId });
    expect((await db.select().from(outbox))[0].status).toBe("sent");
    expect((await db.select().from(deals).where(eq(deals.id, dealId)))[0].awaitingReplySince).toBeNull();
  });

  it("a cliente escreveu depois de agendar: não sai e a autora é avisada", async () => {
    await scheduleMessage({ dealId, text: "Confirma amanhã?", at: AT }, sara, T0);
    await recordInbound({ channelId: null, externalId: "IN2", phoneRaw: "71999990021", body: "Não vou poder ir", at: plus(T0, 60), now: plus(T0, 60) });
    expect((await drainOutbox(AT)).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await failAlert()).toMatchObject({ userId: sara, audience: "responsavel", dealId,
      message: "Mensagem agendada para Cliente Teste não saiu: a cliente escreveu depois que você agendou. Abra a conversa e decida se envia." });
  });

  it("com “não sai se ela escrever” desmarcado, sai mesmo assim", async () => {
    await scheduleMessage({ dealId, text: "Bom dia!", at: AT, cancelIfReply: false }, sara, T0);
    await recordInbound({ channelId: null, externalId: "IN2", phoneRaw: "71999990021", body: "Oi", at: plus(T0, 60), now: plus(T0, 60) });
    expect((await drainOutbox(AT)).sent).toBe(1);
  });

  it("quem agendou saiu da equipe: não sai e a gestão é avisada", async () => {
    await scheduleMessage({ dealId, text: "Confirma?", at: AT }, sara, T0);
    await db.update(users).set({ active: false }).where(eq(users.id, sara));
    expect((await drainOutbox(AT)).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
    expect(await failAlert()).toMatchObject({ userId: null, audience: "gestao" });
  });

  it("perdeu a hora (worker parado mais de 2 h): não sai sozinha", async () => {
    await scheduleMessage({ dealId, text: "Confirma?", at: AT }, sara, T0);
    expect((await drainOutbox(plus(AT, 180))).cancelled).toBe(1);
    expect(sent).toHaveLength(0);
    expect((await failAlert()).message).toContain("perdeu a hora (era para hoje 10:00)");
  });

  it("WhatsApp recusou: fica como “não saiu”, não tenta de novo e avisa a autora", async () => {
    await scheduleMessage({ dealId, text: "Confirma?", at: AT }, sara, T0);
    failSend = true;
    expect((await drainOutbox(AT)).failed).toBe(1);
    failSend = false;
    expect(await drainOutbox(plus(AT, 1))).toMatchObject({ sent: 0, failed: 0 });
    expect((await db.select().from(outbox))[0].status).toBe("failed");
    expect((await failAlert()).message).toContain("Evolution recusou");
  });

  it("cancelar tira da fila; enviar agora manda na hora e o worker não manda de novo", async () => {
    const one = await scheduleMessage({ dealId, text: "Primeira", at: AT }, sara, T0);
    await cancelScheduled(one.id, sara);
    expect(await scheduledOf(contactId)).toEqual([]);
    await expect(cancelScheduled(one.id, sara)).rejects.toThrow(/já saiu ou já foi cancelada/);
    const two = await scheduleMessage({ dealId, text: "Agora vai", at: AT }, sara, T0);
    await sendScheduledNow(two.id, sara, plus(T0, 10));
    expect(sent).toHaveLength(1);
    expect((await drainOutbox(AT)).sent).toBe(0);
  });
});
