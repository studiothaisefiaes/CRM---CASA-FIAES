import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deals, users } from "../db/schema";
import { recordInbound, recordOutbound } from "./deals";
import { addNote } from "./notes";
import { getQueue } from "../queries/queue";
import { permsFor } from "../../../test/perms";
import { resetDb } from "../../../test/db";

// Relógio da espera sem ruído (pesquisa 20/10, Help Scout/Digisac): nota interna, mensagem automática e várias mensagens seguidas
// da cliente não zeram nem "furam" a espera; só a resposta de verdade da Casa zera.
const T0 = new Date("2026-10-13T13:00:00Z"); // terça, 10h em Salvador
const at = (min: number) => new Date(T0.getTime() + min * 60_000);
let uid = "";
const since = async (dealId: string) => (await db.select({ s: deals.awaitingReplySince }).from(deals).where(eq(deals.id, dealId)))[0].s;
async function inbound(phone: string, id: string, min: number) {
  const r = await recordInbound({ channelId: null, externalId: id, phoneRaw: phone, body: "oi, tudo bem? quero marcar", at: at(min) });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
}

beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
});

it("várias mensagens seguidas da cliente: a espera conta da primeira", async () => {
  const d = await inbound("71999995555", "A1", 0);
  await inbound("71999995555", "A2", 2);
  await inbound("71999995555", "A3", 7);
  expect((await since(d))?.toISOString()).toBe(at(0).toISOString());
});

it("nota interna não zera a espera", async () => {
  const d = await inbound("71999995555", "B1", 0);
  await addNote({ dealId: d, body: "ela quer progressiva, ver horário com a Maiara" }, uid, at(3));
  expect((await since(d))?.toISOString()).toBe(at(0).toISOString());
});

it("mensagem automática (fora do horário, bot, regra) não zera a espera; a resposta da Casa zera", async () => {
  const d = await inbound("71999995555", "C1", 0);
  await recordOutbound({ dealId: d, channelId: null, body: "Oi! Agora estamos fechadas; respondemos amanhã a partir das 9h.", automated: true, at: at(1) });
  expect((await since(d))?.toISOString()).toBe(at(0).toISOString());
  await recordOutbound({ dealId: d, channelId: null, body: "Oi, Maria! Tenho quinta às 14h.", userId: uid, at: at(5) });
  expect(await since(d)).toBeNull();
});

it("Esperando: a cliente que insiste não fura a fila (a mais antiga continua em cima)", async () => {
  const antiga = await inbound("71999995555", "D1", 0);
  const nova = await inbound("71999996666", "D2", 5);
  await inbound("71999995555", "D3", 9); // a mais antiga escreve de novo
  const q = await getQueue({ id: uid, perms: permsFor("gestor") }, { now: at(12), foco: "aguardando" });
  const ids = q.sections.flatMap((s) => s.items.map((i) => i.dealId));
  expect(ids).toEqual([antiga, nova]);
});
