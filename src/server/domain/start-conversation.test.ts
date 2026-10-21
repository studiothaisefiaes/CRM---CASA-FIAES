import { it, expect, beforeEach, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, outbox, stages, users } from "../db/schema";
import * as dealsModule from "./deals";
import { recordInbound } from "./deals";
import { archiveDeals } from "./archive";
import { startConversation } from "./start-conversation";
import { UserFacingError } from "./errors";
import { resetDb } from "../../../test/db";

// `findOpenDeal` passa direto, a não ser quando o teste manda a primeira chamada "não ver" o lead (simula o lead nascendo entre o lock e o INSERT).
vi.mock("./deals", async (orig) => { const m = await orig<typeof import("./deals")>(); return { ...m, findOpenDeal: vi.fn(m.findOpenDeal) }; });

let uid = "";
beforeEach(async () => {
  await resetDb();
  uid = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});
const contact = async (phone: string, name = "Cliente") => (await db.insert(contacts).values({ phoneE164: phone, name }).returning())[0];
const open = (contactId: string) => db.select().from(deals).where(and(eq(deals.contactId, contactId), isNull(deals.closedAt), isNull(deals.archivedAt)));

it("contato sem lead aberto ganha um lead novo, com a atendente de dona, e nada é enviado", async () => {
  const c = await contact("+5571999990001");
  const r = await startConversation(c.id, uid);
  expect(r.created).toBe(true);
  const [d] = await open(c.id);
  expect(d.id).toBe(r.dealId);
  expect(d.ownerId).toBe(uid);
  expect(d.awaitingReplySince).toBeNull(); // quem começa é a Casa: ninguém espera resposta
  expect(await db.select().from(messages)).toHaveLength(0);
  expect(await db.select().from(outbox)).toHaveLength(0);
});

it("já tem lead aberto: só leva até ele, sem duplicar nem trocar de dono", async () => {
  const r = await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71999990002", body: "oi" });
  if (!("dealId" in r)) throw new Error();
  const bia = (await db.insert(users).values({ name: "Bia", email: "bia@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  await db.update(deals).set({ ownerId: bia }).where(eq(deals.id, r.dealId));
  const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990002"));
  const again = await startConversation(c.id, uid);
  expect(again).toEqual({ dealId: r.dealId, created: false });
  expect(await open(c.id)).toHaveLength(1);
  const [d] = await open(c.id);
  expect(d.ownerId).toBe(bia); // o dono que já existia continua
});

it("duas chamadas ao mesmo tempo acabam no mesmo lead", async () => {
  const c = await contact("+5571999990003");
  const [a, b] = await Promise.all([startConversation(c.id, uid), startConversation(c.id, uid)]);
  expect(a.dealId).toBe(b.dealId);
  expect(await open(c.id)).toHaveLength(1);
});

it("lead anterior já fechado não é reaberto: nasce um novo e o antigo fica como estava", async () => {
  const c = await contact("+5571999990004");
  const first = await startConversation(c.id, uid);
  const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
  await db.update(deals).set({ stageId: fechado.id, closedAt: new Date(), valueCents: 15000 }).where(eq(deals.id, first.dealId));
  const next = await startConversation(c.id, uid);
  expect(next.created).toBe(true);
  expect(next.dealId).not.toBe(first.dealId);
  const [old] = await db.select().from(deals).where(eq(deals.id, first.dealId));
  expect(old.valueCents).toBe(15000);
});

it("contato 'Não é cliente' não abre lead: precisa voltar a ser cliente antes", async () => {
  const r = await recordInbound({ channelId: null, externalId: "S5", phoneRaw: "71999990005", body: "oi" });
  if (!("dealId" in r)) throw new Error();
  await archiveDeals([r.dealId], uid);
  const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990005"));
  await expect(startConversation(c.id, uid)).rejects.toBeInstanceOf(UserFacingError);
  expect(await open(c.id)).toHaveLength(0);
});

it("contato que não existe", async () => {
  await expect(startConversation("00000000-0000-4000-8000-000000000000", uid)).rejects.toBeInstanceOf(UserFacingError);
});

it("o lead abriu entre o lock e o INSERT: o índice único barra, e devolve o lead que ficou aberto (sem erro, sem duplicar)", async () => {
  const c = await contact("+5571999990006");
  const [stage] = await db.select().from(stages).where(eq(stages.key, "lead"));
  const [other] = await db.insert(deals).values({ contactId: c.id, stageId: stage.id, origin: "WhatsApp" }).returning();
  // A primeira conferência (dentro da transação) não vê o lead; a segunda, depois do conflito, vê.
  vi.mocked(dealsModule.findOpenDeal).mockImplementationOnce(async () => null as never);
  const r = await startConversation(c.id, uid);
  expect(r).toEqual({ dealId: other.id, created: false });
  expect(await open(c.id)).toHaveLength(1);
  expect(await db.select().from(messages)).toHaveLength(0);
});

it("o lead novo usa o mesmo relógio dos outros leads (o do app): com o relógio do banco atrasado, a ordem dos leads não inverte", async () => {
  // No Mac o Postgres roda numa VM (colima) cujo relógio pode atrasar segundos depois de o computador dormir. O lead que chega pelo WhatsApp
  // grava a hora do app; se este gravasse o now() do banco, o lead novo poderia ficar "mais velho" que o anterior e a ficha os mostraria trocados.
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 60_000 }); // o app 1 min à frente do banco
  try {
    const r = await recordInbound({ channelId: null, externalId: "REL1", phoneRaw: "71999990077", pushName: "Mariana", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    const [first] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    await db.update(deals).set({ stageId: (await db.select().from(stages).where(eq(stages.key, "fechado")))[0].id, closedAt: new Date() }).where(eq(deals.id, first.id));
    vi.setSystemTime(Date.now() + 1000); // o relógio falso fica parado: anda 1 s até o segundo lead
    const second = await startConversation(first.contactId, uid);
    const [d2] = await db.select().from(deals).where(eq(deals.id, second.dealId));
    expect(d2.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
  } finally { vi.useRealTimers(); }
});
