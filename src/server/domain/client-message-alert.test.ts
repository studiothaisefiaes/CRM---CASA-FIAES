import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, settings, stages, users } from "../db/schema";
import { runRules } from "../rules/engine";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { markSeen } from "./seen";
import { CLIENT_MESSAGE_ALERT, noticeClientMessage } from "./client-message-alert";

let ana = "";
const now = () => new Date();
const open = (dealId: string) => db.select().from(alerts).where(and(eq(alerts.dealId, dealId), eq(alerts.type, CLIENT_MESSAGE_ALERT), isNull(alerts.resolvedAt)));
const inbound = async (ext: string, body: string, extra: Partial<Parameters<typeof recordInbound>[0]> = {}) => {
  const r = await recordInbound({ channelId: null, externalId: ext, phoneRaw: "71900000101", pushName: "Cliente Teste", body, at: now(), ...extra });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};
async function inStage(key: string) {
  const id = await inbound("A0", "oi");
  await db.update(alerts).set({ resolvedAt: now() }).where(eq(alerts.dealId, id));
  const [st] = await db.select().from(stages).where(eq(stages.key, key));
  await db.update(deals).set({ stageId: st.id, ownerId: ana }).where(eq(deals.id, id));
  await recordOutbound({ dealId: id, channelId: null, body: "Combinado!", at: now() });
  return id;
}

beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

describe("toda mensagem da cliente avisa, em qualquer etapa", () => {
  for (const key of ["agendado", "na_casa", "atendida", "orcamento", "atendimento"]) {
    it(`em ${key}: aviso no sino para a dona, com a prévia da mensagem`, async () => {
      const id = await inStage(key);
      await inbound("A1", "Posso chegar 15 min mais tarde?");
      const [a] = await open(id);
      expect(a).toMatchObject({ userId: ana, audience: "responsavel", severity: "info", waitKey: null });
      expect(a.message).toBe("Cliente Teste escreveu: “Posso chegar 15 min mais tarde?”");
    });
  }

  it("conversa encerrada que recebe só 'obrigada' continua encerrada (regra do remarketing), mas avisa", async () => {
    const id = await inStage("atendida");
    await db.update(deals).set({ conversationArchivedAt: now() }).where(eq(deals.id, id));
    await inbound("A2", "Obrigada!");
    expect((await db.select().from(deals).where(eq(deals.id, id)))[0].conversationArchivedAt).not.toBeNull();
    expect(await open(id)).toHaveLength(1);
  });

  it("mensagens seguidas renovam o mesmo aviso; abrir a conversa ou responder tira do sino", async () => {
    const id = await inStage("agendado");
    await inbound("A3", "oi"); await inbound("A4", "tudo bem?");
    const list = await open(id);
    expect(list).toHaveLength(1);
    expect(list[0].message).toContain("tudo bem?");
    await markSeen(id, ana, new Date(Date.now() + 1000));
    expect(await open(id)).toHaveLength(0);
    await inbound("A5", "e aí?", { at: new Date(Date.now() + 2000), now: new Date(Date.now() + 2000) });
    expect(await open(id)).toHaveLength(1);
    await recordOutbound({ dealId: id, channelId: null, body: "Oi!", at: new Date(Date.now() + 3000) });
    expect(await open(id)).toHaveLength(0);
  });

  it("sem dona vai para a gestão; ligação atendida, reação e mensagem velha não avisam", async () => {
    const id = await inbound("B1", "oi");
    await db.update(deals).set({ ownerId: null }).where(eq(deals.id, id));
    await db.update(alerts).set({ resolvedAt: now() }).where(eq(alerts.dealId, id));
    await inbound("B0", "alguém?");
    expect((await open(id))[0]).toMatchObject({ userId: null, audience: "gestao" });
    await db.update(alerts).set({ resolvedAt: now() }).where(eq(alerts.dealId, id));
    await inbound("B2", "Ligação atendida", { kind: "call", noWait: true });
    await inbound("B3", "👍", { kind: "reaction" });
    await inbound("B4", "mensagem de ontem", { at: new Date(Date.now() - 24 * 3_600_000) });
    expect(await open(id)).toHaveLength(0);
  });

  it("contato 'não é cliente' sem conversa aberta não avisa", async () => {
    const id = await inbound("C1", "oi");
    await db.update(alerts).set({ resolvedAt: now() }).where(eq(alerts.dealId, id));
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.phoneE164, "+5571900000101"));
    await db.update(deals).set({ archivedAt: now() }).where(eq(deals.id, id));
    expect(await recordInbound({ channelId: null, externalId: "C2", phoneRaw: "71900000101", body: "oi de novo", at: now() })).toEqual({ ignored: true });
    expect(await db.select().from(alerts).where(and(eq(alerts.type, CLIENT_MESSAGE_ALERT), isNull(alerts.resolvedAt)))).toHaveLength(0);
  });

  it("quando a espera passa do prazo, o aviso de atraso substitui o 'escreveu' (um aviso só por conversa no sino)", async () => {
    const allDay: [string, string] = ["00:00", "24:00"];
    await db.insert(settings).values({ key: "business_hours", value: { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay } });
    const id = await inbound("D1", "oi, alguém?", { at: new Date(Date.now() - 20 * 60_000) });
    expect(await open(id)).toHaveLength(1);
    await runRules(new Date());
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, id), eq(alerts.type, "sem_resposta_minutos"), isNull(alerts.resolvedAt)))).not.toHaveLength(0);
    expect(await open(id)).toHaveLength(0);
  });

  it("mensagens ao mesmo tempo (foto + texto no mesmo segundo, webhook em paralelo): um aviso só", async () => {
    const id = await inStage("agendado");
    const at = new Date();
    await Promise.all(["P1", "P2", "P3", "P4"].map((m, i) => noticeClientMessage({ dealId: id, messageId: `00000000-0000-4000-8000-00000000000${i}`, kind: "text", body: m, at })));
    expect(await open(id)).toHaveLength(1);
  });

  it("no máximo um push por conversa a cada 5 min: mensagem nova renova o aviso, mas só volta a notificar o celular depois de 5 min do último", async () => {
    const id = await inStage("agendado");
    await inbound("Q1", "oi");
    const [a] = await open(id);
    await db.update(alerts).set({ pushedAt: new Date(Date.now() - 60_000) }).where(eq(alerts.id, a.id)); // o worker mandou o push há 1 min
    await inbound("Q2", "alguém aí?");
    expect((await open(id))[0].pushedAt).not.toBeNull(); // não manda outro push agora
    await db.update(alerts).set({ pushedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(alerts.id, a.id));
    await inbound("Q3", "???");
    expect((await open(id))[0].pushedAt).toBeNull(); // passou de 5 min: notifica de novo
  });
});
