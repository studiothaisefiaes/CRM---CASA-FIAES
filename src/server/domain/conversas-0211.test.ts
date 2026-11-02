import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { permsFor } from "../../../test/perms";
import { db } from "../db";
import { alerts, channels, deals, messages, outbox, settings, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { archiveConversation } from "./conversation-archive";
import { mergeLidInto } from "./lid-merge";
import { mergeContacts } from "./merge-contacts";
import { saveWelcomeMenu } from "./welcome-menu";
import { saveAutoMessage } from "./auto-message-settings";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { getQueue } from "../queries/queue";
import { getBoard } from "../queries/board";
import { getDealDetail } from "../queries/deal";

// Correções de Conversas/Fila (revisão 02/11). Dados sintéticos.
const OPEN: [string, string] = ["00:00", "23:59"];
const HOURS = { 0: OPEN, 1: OPEN, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const t = (min: number) => new Date(Date.now() - min * 60_000);
let sara = "", bia = "", channelId = "";
const asUser = (id: string) => ({ id, name: "Sara", email: "sara@teste.local", perms: permsFor("gestor") });
const deal = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const entra = async (ext: string, phone: string, body: string, at: Date, lid?: string) => {
  const r = await recordInbound({ channelId, externalId: ext, phoneRaw: phone, lid, pushName: "Paula", body, at, now: at });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};
const responde = (dealId: string, ext: string, at: Date) => recordOutbound({ dealId, channelId, externalId: ext, body: "Oi! Temos sim", userId: sara, at });
const automatica = (dealId: string, ext: string, at: Date) => recordOutbound({ dealId, channelId, externalId: ext, body: "Bem-vinda", automated: true, at });
const aviso = (dealId: string, type = "sem_resposta_minutos", waitKey: string | null = `${dealId}:espera`) =>
  db.insert(alerts).values({ dealId, audience: "responsavel", type, severity: "urgente", message: "m", dedupeKey: `${type}:${dealId}`, waitKey }).returning().then((r) => r[0]);
const abertos = (dealId: string) => db.select().from(alerts).where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)));
const tarefa = async (dealId: string, dueAt: Date, kind: "proxima_acao" | "retorno" | "comparecimento" = "proxima_acao") => {
  const d = await deal(dealId);
  return (await db.insert(tasks).values({ dealId, contactId: d.contactId, kind, title: "Retomar", dueAt, assigneeId: sara }).returning())[0];
};
const ids = (q: Awaited<ReturnType<typeof getQueue>>) => q.sections.flatMap((s) => s.items.map((i) => i.dealId));

beforeEach(async () => {
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: sara }] = await db.insert(users).values({ name: "Sara", email: "sara@teste.local", role: "gestor", passwordHash: "x" }).returning();
  [{ id: bia }] = await db.insert(users).values({ name: "Bia", email: "bia@teste.local", role: "atendente", passwordHash: "x" }).returning();
  [{ id: channelId }] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
});
afterEach(() => setWhatsappProvider(null));

describe("1. junção reabre a espera: a conversa sai do Resolvido", () => {
  it("@lid: a cliente esperando no número oculto não some dentro da conversa Resolvida", async () => {
    const id = await entra("IN1", "5571999990031", "oi", t(120));
    await responde(id, "OUT1", t(110));
    await archiveConversation(id, sara);
    const voltou = t(10);
    await entra("IN2", "", "voltei, tem horário amanhã?", voltou, "555");
    await mergeLidInto("555", "+5571999990031");
    const d = await deal(id);
    expect(d.conversationArchivedAt).toBeNull();
    expect(d.awaitingReplySince?.getTime()).toBe(voltou.getTime());
  });

  it("@lid: as duas resolvidas continuam resolvidas e sem espera", async () => {
    const id = await entra("IN1", "5571999990032", "oi", t(120));
    await responde(id, "OUT1", t(110));
    await archiveConversation(id, sara);
    const h = await entra("IN2", "", "ok", t(100), "556");
    await archiveConversation(h, sara);
    await mergeLidInto("556", "+5571999990032");
    const d = await deal(id);
    expect(d.conversationArchivedAt).not.toBeNull();
    expect(d.awaitingReplySince).toBeNull();
  });

  it("Unir cadastros: a que sai esperando tira a que fica do Resolvido", async () => {
    const fica = await entra("IN1", "5571999990033", "oi", t(120));
    await responde(fica, "OUT1", t(110));
    await archiveConversation(fica, sara);
    const sai = await entra("IN2", "5571999990034", "quero marcar", t(10));
    const [k, dr] = await Promise.all([deal(fica), deal(sai)]);
    await mergeContacts({ keepId: k.contactId, dropId: dr.contactId }, sara);
    const d = await deal(fica);
    expect(d.conversationArchivedAt).toBeNull();
    expect(d.awaitingReplySince).not.toBeNull();
  });
});

describe("2. recalcular a espera conta só resposta humana enviada", () => {
  it("automática e mensagem que falhou não zeram a espera nem resolvem o aviso", async () => {
    const id = await entra("IN1", "5571999990035", "quero um orçamento", t(60));
    await aviso(id);
    await automatica(id, "A1", t(59));
    const d0 = await deal(id);
    await db.insert(messages).values({ dealId: id, contactId: d0.contactId, direction: "out", kind: "text", body: "Oi", status: "failed", sentByUserId: sara, createdAt: t(58) });
    await entra("IN2", "", "oi", t(120), "557");
    await mergeLidInto("557", "+5571999990035");
    const d = await deal(id);
    expect(d.awaitingReplySince).not.toBeNull();
    expect((await abertos(id)).map((a) => a.type)).toContain("sem_resposta_minutos");
  });
});

describe("3. Resolvida com mensagem nova e retomada: uma vez só em Para retomar", () => {
  it("contador 1 e uma linha", async () => {
    const id = await entra("IN1", "5571999990036", "oi", t(120));
    await responde(id, "OUT1", t(110));
    await tarefa(id, new Date(Date.now() + 86_400_000));
    await archiveConversation(id, sara);
    await entra("IN2", "5571999990036", "Obrigada!", new Date(Date.now() + 1000));
    expect((await deal(id)).conversationArchivedAt).not.toBeNull();
    const q = await getQueue(asUser(sara), { foco: "retomar" });
    expect(ids(q)).toEqual([id]);
    expect(q.counts.retomar).toBe(1);
  });
});

describe("4. Resolver encerra também o retorno vencido", () => {
  it("retorno vencido é cancelado; o futuro fica", async () => {
    const id = await entra("IN1", "5571999990037", "oi", t(120));
    const v = await tarefa(id, t(60), "retorno");
    const f = await tarefa(id, new Date(Date.now() + 86_400_000), "retorno");
    await archiveConversation(id, sara);
    const get = async (x: string) => (await db.select().from(tasks).where(eq(tasks.id, x)))[0].doneAt;
    expect(await get(v.id)).not.toBeNull();
    expect(await get(f.id)).toBeNull();
  });
});

describe("5. Para retomar = próxima ação + retorno (comparecimento não é retomada)", () => {
  it("comparecimento não vira Para retomar na Fila", async () => {
    const id = await entra("IN1", "5571999990038", "oi", t(120));
    await responde(id, "OUT1", t(110));
    await tarefa(id, new Date(Date.now() + 86_400_000), "comparecimento");
    const q = await getQueue(asUser(sara), {});
    const item = q.sections.flatMap((s) => s.items).find((i) => i.dealId === id);
    expect(item?.nextAction).toBeUndefined();
    expect(q.counts.retomar).toBe(0);
  });
  it("o painel mostra o retorno como próxima ação", async () => {
    const id = await entra("IN1", "5571999990039", "oi", t(120));
    const r = await tarefa(id, new Date(Date.now() + 86_400_000), "retorno");
    expect((await getDealDetail(id))?.nextAction?.id).toBe(r.id);
  });
});

describe("6. filtros da aba Todas valem também para as Resolvidas", () => {
  it("filtro por dona não traz a Resolvida de outra", async () => {
    const a = await entra("IN1", "5571999990040", "oi", t(120));
    const b = await entra("IN2", "5571999990041", "oi", t(120));
    await db.update(deals).set({ ownerId: sara }).where(eq(deals.id, a));
    await db.update(deals).set({ ownerId: bia }).where(eq(deals.id, b));
    await archiveConversation(a, sara);
    await archiveConversation(b, sara);
    const q = await getQueue(asUser(sara), { dono: sara });
    expect(ids(q)).toEqual([a]);
  });
});

describe("7. só link + automática: os avisos de espera se resolvem", () => {
  it("o aviso de espera se resolve; o 'a cliente escreveu' não", async () => {
    const id = await entra("IN1", "5571999990042", "https://youtube.com/shorts/x", t(30));
    await aviso(id);
    // o "a cliente escreveu" nasce com a mensagem (noticeClientMessage)
    expect((await abertos(id)).map((a) => a.type).sort()).toEqual(["mensagem_cliente", "sem_resposta_minutos"]);
    await automatica(id, "A1", t(29));
    expect((await deal(id)).awaitingReplySince).toBeNull();
    expect((await abertos(id)).map((a) => a.type)).toEqual(["mensagem_cliente"]);
  });
});

describe("8. menu de boas-vindas: uma automática só, e nada para mensagem velha", () => {
  const MENU = { enabled: true, intro: "Olá! Responda com o número:", options: [{ label: "Agendar", tag: null }, { label: "Preços", tag: null }] };
  it("boas-vindas e menu ligados: o primeiro contato recebe uma só", async () => {
    await saveWelcomeMenu(MENU, sara);
    await saveAutoMessage("boas_vindas", { enabled: true, text: "Oi, {nome}!" }, sara);
    const now = new Date();
    await recordInbound({ channelId, externalId: "IN1", phoneRaw: "5571999990043", pushName: "Paula", body: "oi", at: now, now });
    expect(await db.select().from(outbox)).toHaveLength(1);
  });
  it("mensagem velha (reprocessada) não recebe o menu", async () => {
    await saveWelcomeMenu(MENU, sara);
    await recordInbound({ channelId, externalId: "IN1", phoneRaw: "5571999990044", pushName: "Paula", body: "oi", at: t(60), now: new Date() });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});

describe("9. Quadro: Resolvida com retomada superada sai", () => {
  it("retomada vencida com conversa depois não segura a Resolvida no Quadro", async () => {
    const id = await entra("IN1", "5571999990045", "oi", t(300));
    await responde(id, "OUT1", t(290));
    await archiveConversation(id, sara);
    await tarefa(id, t(200));
    await automatica(id, "A1", t(100));
    expect((await getBoard()).flatMap((s) => s.cards.map((c) => c.id))).not.toContain(id);
  });
});

describe("10. eco atrasado não volta o relógio", () => {
  it("lastOutboundAt fica com a resposta mais nova", async () => {
    const id = await entra("IN1", "5571999990046", "oi", t(60));
    const resposta = t(30);
    await responde(id, "OUT1", resposta);
    await recordOutbound({ dealId: id, channelId, externalId: "OUT0", body: "eco antigo", fromPhone: true, at: t(50) });
    expect((await deal(id)).lastOutboundAt?.getTime()).toBe(resposta.getTime());
  });
});

describe("11. Resolver cancela a mensagem programada da retomada vencida", () => {
  it("a mensagem ligada à tarefa vencida é cancelada", async () => {
    const id = await entra("IN1", "5571999990047", "oi", t(120));
    const v = await tarefa(id, t(60));
    const [o] = await db.insert(outbox).values({ dealId: id, kind: "text", text: "Oi, tudo bem?", options: { source: "agendada", taskId: v.id }, status: "pending", notBefore: t(60), createdBy: sara }).returning();
    await archiveConversation(id, sara);
    const [after] = await db.select().from(outbox).where(eq(outbox.id, o.id));
    expect(after.status).toBe("cancelled");
  });
});
