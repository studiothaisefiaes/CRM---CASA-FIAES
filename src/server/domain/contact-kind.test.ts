import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { permsFor } from "../../../test/perms";
import { db } from "../db";
import { alerts, auditLog, channels, contacts, deals, outbox, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { ignoreContact } from "./deals";
import { setTeamContact } from "./team-contact";
import { setContactKind } from "./contact-kind";
import { enqueueAutomated, drainOutbox } from "./outbox";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { getQueue } from "../queries/queue";
import { getDealDetail } from "../queries/deal";
import { countLateLeads } from "../queries/late-count";
import { dealScope } from "../reports/common";
import { suggestionState } from "../ai/suggest";

let gestora = { id: "", name: "Gestora", email: "g@c.com", perms: permsFor("gestor") };
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: "OUT" + sent.length }; },
};
const inbound = async (phone: string, ext: string, body = "oi", at = new Date()) => {
  const r = await recordInbound({ channelId: null, externalId: ext, phoneRaw: phone, pushName: "Pessoa Teste", body, at });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};
const contactOf = async (dealId: string) => (await db.select({ c: contacts }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId)))[0].c;
const ids = (q: Awaited<ReturnType<typeof getQueue>>) => q.sections.flatMap((s) => s.items.map((i) => i.dealId));

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  setWhatsappProvider(fake);
  const [g] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  gestora = { ...gestora, id: g.id };
});
afterEach(() => { setWhatsappProvider(null); });

describe("tipo do contato: compatível com is_team e ignored", () => {
  it("o que já existe (É da equipe, Não é cliente) muda o tipo, e o tipo acerta as colunas antigas", async () => {
    const a = await inbound("71900000301", "A1");
    const ca = await contactOf(a);
    expect(ca.kind).toBe("cliente");
    await setTeamContact(ca.id, true, gestora.id);
    expect(await contactOf(a)).toMatchObject({ kind: "equipe", isTeam: true, ignored: false });
    const b = await inbound("71900000302", "B1");
    await ignoreContact(b, gestora.id);
    expect(await contactOf(b)).toMatchObject({ kind: "spam", ignored: true, isTeam: false });
    await db.update(contacts).set({ kind: "fornecedor" }).where(eq(contacts.id, ca.id));
    expect(await contactOf(a)).toMatchObject({ kind: "fornecedor", isTeam: false, ignored: false });
  });
});

describe("Marcar como Fornecedor", () => {
  it("resolve a conversa na hora, sai da Fila, das contagens, dos prazos e dos relatórios; fica na lista Fornecedores", async () => {
    await inbound("71900000310", "C0", "quero marcar");
    const forn = await inbound("71900000311", "C1", "boleto do produto segue");
    await db.insert(alerts).values({ dealId: forn, audience: "gestao", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "k1", waitKey: `${forn}:x` });
    const c = await contactOf(forn);
    const r = await setContactKind(c.id, "fornecedor", gestora.id);
    expect(r).toMatchObject({ before: "cliente", dealId: forn, resolved: true });
    const [d] = await db.select().from(deals).where(eq(deals.id, forn));
    expect(d.conversationArchivedAt).not.toBeNull(); // resolvida
    expect(d.awaitingReplySince).toBeNull();
    expect(d.archivedAt).toBeNull(); // nada se perde: a conversa continua na lista própria
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, forn), isNull(alerts.resolvedAt)))).toHaveLength(0);

    const q = await getQueue(gestora);
    expect(ids(q)).not.toContain(forn);
    expect(q.counts.total).toBe(1);
    expect(q.counts.views.fornecedores).toBe(1);
    expect(ids(await getQueue(gestora, { view: "fornecedores" }))).toEqual([forn]);
    expect(await countLateLeads(gestora)).toBe(0);
    const inReports = await db.execute(sql`select d.id from deals d where ${dealScope({ period: "hoje" })}`);
    expect((inReports.rows as { id: string }[]).map((x) => x.id)).not.toContain(forn);
    expect((await getDealDetail(forn))!.contact.kind).toBe("fornecedor");
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "tipo_contato")))[0].data).toEqual({ de: "cliente", para: "fornecedor" });
  });

  it("mensagem nova do fornecedor continua na lista Fornecedores, fora da Fila de clientes", async () => {
    const forn = await inbound("71900000312", "D1");
    await setContactKind((await contactOf(forn)).id, "fornecedor", gestora.id);
    await inbound("71900000312", "D2", "chegou a nota?");
    expect(ids(await getQueue(gestora))).not.toContain(forn);
    expect(ids(await getQueue(gestora, { view: "fornecedores" }))).toEqual([forn]);
  });

  it("não recebe mensagem automática nem lembrete (o que já estava na fila é cancelado)", async () => {
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
    const forn = await inbound("71900000313", "E1");
    await db.update(deals).set({ channelId: ch.id }).where(eq(deals.id, forn));
    await enqueueAutomated({ dealId: forn, kind: "text", text: "Oi! Passando para lembrar do seu horário" });
    await setContactKind((await contactOf(forn)).id, "fornecedor", gestora.id);
    await drainOutbox(new Date("2026-10-13T13:00:00Z"));
    expect(sent).toEqual([]);
    const [o] = await db.select().from(outbox);
    expect(o.status).toBe("cancelled");
  });
});

describe("Marcar como Spam", () => {
  it("some da Fila (o lead é guardado), fica recuperável em Spam e volta com Marcar como cliente", async () => {
    const spam = await inbound("71900000320", "S1", "Claro Empresas: sua fatura");
    const c = await contactOf(spam);
    await setContactKind(c.id, "spam", gestora.id);
    expect(await contactOf(spam)).toMatchObject({ kind: "spam", ignored: true });
    const [d] = await db.select().from(deals).where(eq(deals.id, spam));
    expect(d.archivedAt).not.toBeNull(); // guardado (o antigo "Não é cliente"): fora da Fila e de tudo, nada apagado
    expect(ids(await getQueue(gestora))).not.toContain(spam);
    expect(ids(await getQueue(gestora, { view: "nao-cliente" }))).toEqual([spam]);
    // a IA não sugere resposta para spam
    expect(await suggestionState(spam)).toEqual({ state: "nada" });

    const back = await setContactKind(c.id, "cliente", gestora.id);
    expect(back.before).toBe("spam");
    expect(await contactOf(spam)).toMatchObject({ kind: "cliente", ignored: false });
    const [restored] = await db.select().from(deals).where(eq(deals.id, spam));
    expect(restored.archivedAt).toBeNull();
    expect(ids(await getQueue(gestora, { view: "nao-cliente" }))).toEqual([]);
  });

  it("Spam direto de Fornecedor e de Equipe também funciona", async () => {
    const x = await inbound("71900000321", "S2");
    const c = await contactOf(x);
    await setContactKind(c.id, "equipe", gestora.id);
    expect(ids(await getQueue(gestora, { view: "equipe" }))).toEqual([x]);
    await setContactKind(c.id, "spam", gestora.id);
    expect(await contactOf(x)).toMatchObject({ kind: "spam", isTeam: false, ignored: true });
    await setContactKind(c.id, "fornecedor", gestora.id);
    expect(ids(await getQueue(gestora, { view: "fornecedores" }))).toEqual([x]);
  });

  it("marcar com o mesmo tipo não faz nada", async () => {
    const x = await inbound("71900000322", "S3");
    const c = await contactOf(x);
    expect(await setContactKind(c.id, "cliente", gestora.id)).toMatchObject({ before: "cliente", changed: false });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "tipo_contato"))).toHaveLength(0);
  });
});
