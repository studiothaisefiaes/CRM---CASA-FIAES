import { it, expect, beforeEach } from "vitest";
import { permsFor } from "../../../test/perms";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, deals, users } from "../db/schema";
import { recordInbound } from "./deals";
import { BULK_MAX, bulkIgnoreContacts, bulkUnignoreContacts } from "./bulk";
import { UserFacingError } from "./errors";
import { resetDb } from "../../../test/db";

let gestor = { id: "", perms: permsFor("gestor") }, ana = { id: "", perms: permsFor("atendente") }, bia = { id: "", perms: permsFor("atendente") };
/** Contatos: 0 e 1 da Ana, 2 sem dono, 3 da Bia, 4 sem lead aberto (só contato). */
const cs: string[] = [];
const dealOf: Record<string, string> = {};
const ignored = async (ids: string[]) => Object.fromEntries((await db.select({ id: contacts.id, i: contacts.ignored }).from(contacts).where(inArray(contacts.id, ids))).map((r) => [r.id, r.i]));

beforeEach(async () => {
  await resetDb();
  const mk = async (name: string, role: "gestor" | "atendente") => (await db.insert(users).values({ name, email: `${name}@c.com`, role, passwordHash: "x" }).returning())[0].id;
  gestor = { id: await mk("Gestora", "gestor"), perms: permsFor("gestor") }; ana = { id: await mk("Ana", "atendente"), perms: permsFor("atendente") }; bia = { id: await mk("Bia", "atendente"), perms: permsFor("atendente") };
  cs.length = 0;
  const owners = [ana.id, ana.id, null, bia.id];
  for (const [i, owner] of owners.entries()) {
    const r = await recordInbound({ channelId: null, externalId: `K${i}`, phoneRaw: `7199900100${i}`, body: "oi" });
    if (!("dealId" in r)) throw new Error();
    await db.update(deals).set({ ownerId: owner }).where(eq(deals.id, r.dealId));
    const [d] = await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, r.dealId));
    cs.push(d.c); dealOf[d.c] = r.dealId;
  }
  cs.push((await db.insert(contacts).values({ phoneE164: "+5571999001004", name: "Só contato" }).returning())[0].id);
});

it("a atendente marca os dela, os sem dono e os sem lead; o da Bia fica de fora", async () => {
  const r = await bulkIgnoreContacts(cs, ana);
  expect(r.ignored).toBe(4);
  expect(r.skipped).toBe(1);
  const st = await ignored(cs);
  expect(cs.map((c) => st[c])).toEqual([true, true, true, false, true]);
  expect(r.dealIds.sort()).toEqual([dealOf[cs[0]], dealOf[cs[1]], dealOf[cs[2]]].sort());
  expect(r.contactIds).toEqual([cs[4]]); // o que não tinha lead foi marcado direto: o Desfazer precisa saber
});

it("a gestão marca todos e tudo fica na auditoria", async () => {
  const r = await bulkIgnoreContacts(cs, gestor);
  expect(r.ignored).toBe(5);
  const log = await db.select().from(auditLog);
  expect(log.filter((l) => l.action === "arquivou_lead")).toHaveLength(4);
  expect(log.filter((l) => l.action === "ignorou_contato")).toHaveLength(1);
});

it("Desfazer devolve exatamente o que saiu: leads na etapa de antes e contatos marcados direto", async () => {
  const before = await db.select({ id: deals.id, stage: deals.stageId, owner: deals.ownerId }).from(deals);
  const r = await bulkIgnoreContacts(cs, gestor);
  const back = await bulkUnignoreContacts({ dealIds: r.dealIds, contactIds: r.contactIds }, gestor);
  expect(back.restored + back.direct).toBe(5);
  expect(back.conflicts).toEqual([]);
  expect(Object.values(await ignored(cs)).every((v) => v === false)).toBe(true);
  const after = await db.select({ id: deals.id, stage: deals.stageId, owner: deals.ownerId, archivedAt: deals.archivedAt }).from(deals);
  expect(after.every((d) => d.archivedAt === null)).toBe(true);
  expect(after.map(({ id, stage, owner }) => ({ id, stage, owner })).sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
});

it("Desfazer não tira a marca de quem já estava como 'Não é cliente' antes", async () => {
  await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, cs[4]));
  const r = await bulkIgnoreContacts(cs, gestor);
  expect(r.contactIds).toEqual([]); // já estava marcado: não é do Desfazer
  await bulkUnignoreContacts({ dealIds: r.dealIds, contactIds: r.contactIds }, gestor);
  expect((await ignored([cs[4]]))[cs[4]]).toBe(true);
});

it("a atendente não desfaz o lead de outra pessoa", async () => {
  const r = await bulkIgnoreContacts(cs, gestor);
  const back = await bulkUnignoreContacts({ dealIds: r.dealIds, contactIds: r.contactIds }, ana);
  expect(back.restored).toBe(3);
  expect((await ignored([cs[3]]))[cs[3]]).toBe(true);
});

it("mais de 100 de uma vez, recusa", async () => {
  const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  await expect(bulkIgnoreContacts(ids, gestor)).rejects.toBeInstanceOf(UserFacingError);
  await expect(bulkUnignoreContacts({ dealIds: ids.slice(0, 60), contactIds: ids.slice(60) }, gestor)).rejects.toBeInstanceOf(UserFacingError);
});
