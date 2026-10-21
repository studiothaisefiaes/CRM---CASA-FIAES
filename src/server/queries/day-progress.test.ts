import { beforeEach, expect, it } from "vitest";
import { eq, ne } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealEvents, deals, users } from "../db/schema";
import { recordInbound, recordOutbound } from "../domain/deals";
import { resolveWithoutReply } from "../domain/resolve";
import { getDayProgress, getDayProgressLine } from "./day-progress";
import { dayProgressText, waitedFor } from "../../lib/day-progress";
import { resetDb } from "../../../test/db";

// Progresso do dia (pesquisa 20/10): "X de Y respondidas hoje", da Casa toda e sem ranking; estado vazio positivo.
const T0 = new Date("2026-10-13T13:00:00Z"); // terça, 10h em Salvador
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
let uid = "";
async function inbound(phone: string, min: number) {
  const r = await recordInbound({ channelId: null, externalId: `P-${phone}-${min}`, phoneRaw: phone, body: "oi, quero marcar", at: at(min) });
  if (!("dealId" in r)) throw new Error();
  return r.dealId;
}
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Sara", email: "s@c.com", role: "atendente", passwordHash: "x" }).returning();
});

it("conta respondidas hoje e quem espera agora; quem voltou a esperar não conta como respondida; ontem não entra", async () => {
  const ontem = await inbound("71999990001", -24 * 60);
  await recordOutbound({ dealId: ontem, channelId: null, body: "Oi!", userId: uid, at: at(-24 * 60 + 5) }); // respondida ontem
  await db.update(dealEvents).set({ createdAt: at(-24 * 60 + 5) }).where(eq(dealEvents.dealId, ontem)); // o evento nasce com a hora real
  const a = await inbound("71999990002", 0);
  const b = await inbound("71999990003", 5);
  const c = await inbound("71999990004", 10);
  await inbound("71999990005", 20); // esperando
  await recordOutbound({ dealId: a, channelId: null, body: "Oi!", userId: uid, at: at(15) });
  await recordOutbound({ dealId: b, channelId: null, body: "Oi!", userId: uid, at: at(16) });
  await resolveWithoutReply(c, uid, at(17)); // "não precisa responder" também foi cuidada
  await inbound("71999990003", 30); // b escreveu de novo: volta a esperar
  // Os eventos nascem com a hora real do relógio: a conta usa "hoje" do instante pedido, então o teste põe o dia de hoje neles.
  await db.update(dealEvents).set({ createdAt: at(20) }).where(ne(dealEvents.dealId, ontem));
  const p = await getDayProgress(at(40));
  expect(p).toMatchObject({ answered: 2, waiting: 2, total: 4 });
  expect(p.oldestSince?.toISOString()).toBe(at(20).toISOString());
  expect(await getDayProgressLine(at(40))).toEqual({ text: "2 de 4 respondidas hoje · a mais antiga espera há 20 min", done: false });
});

it("fora da conta: Não é cliente/Spam e conversa arquivada", async () => {
  const spam = await inbound("71999990011", 0);
  const cid = (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, spam)))[0].c;
  await db.update(contacts).set({ kind: "spam" }).where(eq(contacts.id, cid));
  const arq = await inbound("71999990012", 0);
  await db.update(deals).set({ archivedAt: at(1) }).where(eq(deals.id, arq));
  expect(await getDayProgress(at(5))).toMatchObject({ answered: 0, waiting: 0, total: 0 });
});

it("textos: número neutro e estado vazio positivo", () => {
  expect(waitedFor(0, 14 * 60_000)).toBe("há 14 min");
  expect(waitedFor(0, 130 * 60_000)).toBe("há 2 h 10");
  expect(waitedFor(0, 120 * 60_000)).toBe("há 2 h");
  expect(waitedFor(0, 3 * 86_400_000)).toBe("há 3 dias");
  expect(dayProgressText({ answered: 12, total: 12, waiting: 0, oldestSince: null }, 0)).toEqual({ text: "Ninguém esperando resposta. 12 conversas respondidas hoje.", done: true });
  expect(dayProgressText({ answered: 0, total: 0, waiting: 0, oldestSince: null }, 0)).toEqual({ text: "Ninguém esperando resposta.", done: true });
  expect(dayProgressText({ answered: 12, total: 15, waiting: 3, oldestSince: null }, 0)?.text).toBe("12 de 15 respondidas hoje");
});
