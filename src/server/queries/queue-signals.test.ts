import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { deals, lists, users } from "../db/schema";
import { transferDeal } from "../domain/assign";
import { recordInbound } from "../domain/deals";
import { getQueue } from "./queue";
import { permsFor } from "../../../test/perms";
import { resetDb } from "../../../test/db";

const MIN = 60_000;
const NOW = new Date();
let gest: { id: string; perms: ReturnType<typeof permsFor> };
const inbound = async (phone: string, name: string, body: string, minAgo: number) => {
  const r = await recordInbound({ channelId: null, externalId: `${phone}-${minAgo}`, phoneRaw: phone, pushName: name, body, at: new Date(NOW.getTime() - minAgo * MIN) });
  if (!("dealId" in r)) throw new Error();
  return r.dealId;
};
const itemsOf = async (opts: Parameters<typeof getQueue>[1] = {}) => (await getQueue(gest, { now: NOW, ...opts })).sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.key })));

describe("sinais na Fila", () => {
  beforeEach(async () => {
    await resetDb();
    const [g] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    gest = { id: g.id, perms: permsFor("gestor") };
  });

  it("reclamação sobe dentro da mesma seção, mesmo esperando menos", async () => {
    await inbound("71998600001", "Calma", "oi, tudo bem?", 40);
    await inbound("71998600002", "Brava", "não gostei do resultado, ficou ruim", 20);
    const sec = (await itemsOf()).filter((i) => i.section === (i.section));
    const names = sec.filter((i) => i.section === sec[0].section).map((i) => i.name);
    expect(names.indexOf("Brava")).toBeLessThan(names.indexOf("Calma"));
    expect(sec.find((i) => i.name === "Brava")!.signals).toContain("Reclamação");
  });

  it("interesse pelo serviço cadastrado e palavra-chave da gestão viram etiquetas", async () => {
    await db.insert(lists).values([
      { kind: "service", label: "Progressiva", position: 50 },
      { kind: "keyword", label: "Mega hair", body: "mega hair\naplique", meta: { boost: false }, position: 0 },
    ]);
    await inbound("71998600003", "Ivone", "quero fazer progressiva, e vocês colocam aplique?", 5);
    const it = (await itemsOf()).find((i) => i.name === "Ivone")!;
    // etiquetas de estado (Novo, Sem dono) + no máximo 2 de sinal: a palavra-chave da gestão vem antes do interesse
    expect(it.signals).toEqual(expect.arrayContaining(["Mega hair", "Interesse: Progressiva"]));
    expect(it.signals.length).toBeLessThanOrEqual(2); // só sinais automáticos, no máximo 2
    expect(it.badges).toContain("Novo"); // estado fica separado dos sinais
  });

  it("foco Reclamação e Evento filtram a Fila", async () => {
    await inbound("71998600004", "Noiva Nina", "sou noiva, caso em dezembro", 5);
    await inbound("71998600005", "Rita", "estragou meu cabelo", 5);
    expect((await itemsOf({ foco: "evento" })).map((i) => i.name)).toEqual(["Noiva Nina"]);
    expect((await itemsOf({ foco: "reclamacao" })).map((i) => i.name)).toEqual(["Rita"]);
  });

  it("palavra-chave com 'subir na Fila' passa na frente dentro da seção", async () => {
    await db.insert(lists).values({ kind: "keyword", label: "VIP", body: "vip", meta: { boost: true }, position: 0 });
    await inbound("71998600006", "Antiga", "oi", 30);
    await inbound("71998600007", "Vip", "sou cliente vip", 3);
    const items = await itemsOf();
    const same = items.filter((i) => i.section === items.find((x) => x.name === "Vip")!.section).map((i) => i.name);
    expect(same.indexOf("Vip")).toBeLessThan(same.indexOf("Antiga"));
  });
});

describe("conversa transferida fica marcada na Fila", () => {
  beforeEach(async () => {
    await resetDb();
    const [g] = await db.insert(users).values({ name: "Thaíse Fiaes", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    gest = { id: g.id, perms: permsFor("gestor") };
  });

  it("'Bruna te passou esta conversa' até a nova responsável responder", async () => {
    const [bruna] = await db.insert(users).values({ name: "Bruna Lima", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
    const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
    const id = await inbound("71998600009", "Rita", "quero marcar mechas", 3);
    await db.update(deals).set({ ownerId: bruna.id }).where(eq(deals.id, id)); // estava com a Bruna
    await transferDeal(id, ana.id, bruna.id);
    const it1 = (await itemsOf()).find((i) => i.name === "Rita")!;
    expect(it1.transferNote).toBe("Bruna passou para Ana"); // quem olha é a gestão
    const comoAna = (await getQueue({ id: ana.id, perms: permsFor("atendente") }, { now: NOW })).sections.flatMap((s) => s.items).find((i) => i.name === "Rita")!;
    expect(comoAna.transferNote).toBe("Bruna te passou esta conversa");
    // a Ana respondeu (1 s depois: o evento usa o relógio do banco, que no Docker do Mac pode estar adiantado)
    await db.update(deals).set({ lastOutboundAt: new Date(Date.now() + 1000) }).where(eq(deals.id, id));
    expect((await itemsOf()).find((i) => i.name === "Rita")!.transferNote).toBeUndefined();
  });

  it("quem pega para si (assumir) não vira transferida", async () => {
    const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
    const id = await inbound("71998600010", "Sol", "oi", 3);
    await transferDeal(id, ana.id, ana.id);
    expect((await itemsOf()).find((i) => i.name === "Sol")!.transferNote).toBeUndefined();
  });
});
