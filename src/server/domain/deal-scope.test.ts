import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { alerts, auditLog, deals, messages, outbox, settings, tasks, users } from "@/server/db/schema";
import { recordInbound } from "./deals";
import { assertCanActOnDeal, assertCanActOnMessage, assertCanActOnOutbox, getStrictScope, OUT_OF_SCOPE, setStrictScope, STRICT_SCOPE_SETTING } from "./deal-scope";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";

/**
 * Revisão de segurança 17/10 (M1): sem "Ver conversas de todas", a pessoa só mexe nas próprias conversas e nas sem dono —
 * a mesma regra das listas (queue.ts). Com ela (a gestão), tudo, como antes.
 */
const mkUser = async (name: string) => (await db.insert(users).values({ name, email: `${name}-${Math.random()}@c.com`, passwordHash: "x" }).returning())[0].id;
const mkDeal = async (phone: string, ownerId: string | null) => {
  const r = await recordInbound({ channelId: null, externalId: `S-${phone}-${Math.random()}`, phoneRaw: phone, pushName: "Cliente", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId }).where(eq(deals.id, r.dealId));
  return r.dealId;
};

let ana: { id: string; perms: string[] }, bia: { id: string; perms: string[] }, gestora: { id: string; perms: string[] };
beforeEach(async () => {
  await resetDb();
  ana = { id: await mkUser("ana"), perms: permsFor("atendente") };
  bia = { id: await mkUser("bia"), perms: permsFor("atendente") };
  gestora = { id: await mkUser("gestora"), perms: permsFor("gestor") };
  // A regra nova vale com a chave "Atendente só mexe nas próprias conversas e nas sem dono" ligada (nasce desligada).
  await setStrictScope(true, gestora.id);
});

describe("assertCanActOnDeal", () => {
  it("atendente com a conversa de uma colega: recusa com o texto para a tela", async () => {
    const d = await mkDeal("71999970001", bia.id);
    await expect(assertCanActOnDeal(ana, d)).rejects.toThrow(OUT_OF_SCOPE);
  });
  it("atendente com conversa sem dono: aceita", async () => {
    const d = await mkDeal("71999970002", null);
    await expect(assertCanActOnDeal(ana, d)).resolves.toBeUndefined();
  });
  it("atendente com a própria conversa: aceita", async () => {
    const d = await mkDeal("71999970003", ana.id);
    await expect(assertCanActOnDeal(ana, d)).resolves.toBeUndefined();
  });
  it("gestão (atendimento.todas) com a conversa de qualquer pessoa: aceita", async () => {
    const d = await mkDeal("71999970004", bia.id);
    await expect(assertCanActOnDeal(gestora, d)).resolves.toBeUndefined();
  });
  it("conversa da gestão também é de outra pessoa para a atendente", async () => {
    const d = await mkDeal("71999970005", gestora.id);
    await expect(assertCanActOnDeal(ana, d)).rejects.toThrow(OUT_OF_SCOPE);
  });
  it("lead que não existe ou id inválido: deixa a ação dar o próprio erro", async () => {
    await expect(assertCanActOnDeal(ana, "00000000-0000-4000-8000-000000000000")).resolves.toBeUndefined();
    await expect(assertCanActOnDeal(ana, "xyz")).resolves.toBeUndefined();
  });
});

describe("pela mensagem e pelo item do outbox", () => {
  it("mensagem da conversa de uma colega: recusa; sem dono e gestão: aceitam", async () => {
    const dBia = await mkDeal("71999970011", bia.id), dLivre = await mkDeal("71999970012", null);
    const [mBia] = await db.select({ id: messages.id }).from(messages).where(eq(messages.dealId, dBia));
    const [mLivre] = await db.select({ id: messages.id }).from(messages).where(eq(messages.dealId, dLivre));
    await expect(assertCanActOnMessage(ana, mBia.id)).rejects.toThrow(OUT_OF_SCOPE);
    await expect(assertCanActOnMessage(ana, mLivre.id)).resolves.toBeUndefined();
    await expect(assertCanActOnMessage(gestora, mBia.id)).resolves.toBeUndefined();
  });
  it("mensagem programada da conversa de uma colega: recusa; sem dono e gestão: aceitam", async () => {
    const dBia = await mkDeal("71999970021", bia.id), dLivre = await mkDeal("71999970022", null);
    const [oBia] = await db.insert(outbox).values({ dealId: dBia, kind: "text", text: "oi" }).returning({ id: outbox.id });
    const [oLivre] = await db.insert(outbox).values({ dealId: dLivre, kind: "text", text: "oi" }).returning({ id: outbox.id });
    await expect(assertCanActOnOutbox(ana, oBia.id)).rejects.toThrow(OUT_OF_SCOPE);
    await expect(assertCanActOnOutbox(ana, oLivre.id)).resolves.toBeUndefined();
    await expect(assertCanActOnOutbox(gestora, oBia.id)).resolves.toBeUndefined();
  });
});

/** Revisão do código (17/10): quem tem a conversa no escopo pode chamar a colega para ela — oferta da distribuição, menção ou tarefa. */
describe("conversa da colega entregue a ela (oferta, menção ou tarefa em aberto)", () => {
  const alerta = (dealId: string, userId: string, type: string, waitKey: string | null = null) =>
    db.insert(alerts).values({ dealId, userId, type, message: "x", dedupeKey: `${type}:${Math.random()}`, waitKey }).returning({ id: alerts.id });
  it("oferta da distribuição em aberto (\"A dona não respondeu. Pode assumir?\"): aceita; resolvida: recusa", async () => {
    const d = await mkDeal("71999970031", bia.id);
    const [a] = await alerta(d, ana.id, "oferta", `oferta:${d}`);
    await expect(assertCanActOnDeal(ana, d)).resolves.toBeUndefined();
    await db.update(alerts).set({ resolvedAt: new Date() }).where(eq(alerts.id, a.id));
    await expect(assertCanActOnDeal(ana, d)).rejects.toThrow(OUT_OF_SCOPE);
  });
  it("menção em nota (\"pode conferir o Pix?\") ainda não resolvida: aceita", async () => {
    const d = await mkDeal("71999970032", bia.id);
    await alerta(d, ana.id, "mencao");
    await expect(assertCanActOnDeal(ana, d)).resolves.toBeUndefined();
  });
  it("tarefa em aberto para ela: aceita; concluída: recusa", async () => {
    const d = await mkDeal("71999970033", bia.id);
    const [c] = await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, d));
    const [t] = await db.insert(tasks).values({ dealId: d, contactId: c.c, kind: "proxima_acao", title: "Ligar", dueAt: new Date(), assigneeId: ana.id }).returning({ id: tasks.id });
    await expect(assertCanActOnDeal(ana, d)).resolves.toBeUndefined();
    await db.update(tasks).set({ doneAt: new Date() }).where(eq(tasks.id, t.id));
    await expect(assertCanActOnDeal(ana, d)).rejects.toThrow(OUT_OF_SCOPE);
  });
  it("aviso de outra pessoa, de outra conversa ou o \"mensagem nova\" (vai para todas) não abre nada", async () => {
    const d = await mkDeal("71999970034", bia.id), outra = await mkDeal("71999970035", bia.id);
    await alerta(d, bia.id, "mencao");
    await alerta(outra, ana.id, "mencao");
    await db.delete(alerts).where(eq(alerts.dealId, d)); // o recordInbound já criou o "mensagem nova" (um por conversa)
    await alerta(d, bia.id, "mencao");
    await alerta(d, ana.id, "mensagem_cliente");
    await expect(assertCanActOnDeal(ana, d)).rejects.toThrow(OUT_OF_SCOPE);
  });
});

/** Pedido da Casa (17/10): a equipe passa conversas de uma para a outra o tempo todo; a regra estrita é opcional e nasce desligada. */
describe("chave atendimento_escopo_estrito", () => {
  it("nasce desligada; ligar e desligar grava em settings e na auditoria", async () => {
    await db.delete(settings).where(eq(settings.key, STRICT_SCOPE_SETTING));
    expect(await getStrictScope()).toBe(false);
    await setStrictScope(true, gestora.id);
    expect(await getStrictScope()).toBe(true);
    await setStrictScope(false, gestora.id);
    expect(await getStrictScope()).toBe(false);
    const log = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, STRICT_SCOPE_SETTING));
    expect(log.map((l) => l.action)).toEqual(["ligou", "ligou", "desligou"]);
  });
  it("desligada (e sem a linha em settings): a atendente age em qualquer conversa, como antes", async () => {
    const d = await mkDeal("71999970041", bia.id);
    const [m] = await db.select({ id: messages.id }).from(messages).where(eq(messages.dealId, d));
    const [o] = await db.insert(outbox).values({ dealId: d, kind: "text", text: "oi" }).returning({ id: outbox.id });
    await setStrictScope(false, gestora.id);
    await expect(assertCanActOnDeal(ana, d)).resolves.toBeUndefined();
    await expect(assertCanActOnMessage(ana, m.id)).resolves.toBeUndefined();
    await expect(assertCanActOnOutbox(ana, o.id)).resolves.toBeUndefined();
    await db.delete(settings).where(eq(settings.key, STRICT_SCOPE_SETTING));
    await expect(assertCanActOnDeal(ana, d)).resolves.toBeUndefined();
  });
});
