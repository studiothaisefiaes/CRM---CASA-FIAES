import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, stages, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { archiveDeals } from "../domain/archive";
import { startConversation } from "../domain/start-conversation";
import { setNextAction } from "../domain/tasks";
import { closeSale } from "../domain/updates";
import { lists } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getContact } from "./contact";

let uid = "", contactId = "", dealId = "";
beforeEach(async () => {
  await resetDb();
  uid = (await db.insert(users).values({ name: "Ana Souza", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  const r = await recordInbound({ channelId: null, externalId: "C1", phoneRaw: "71999130001", pushName: "Mariana", body: "Oi, quero progressiva" });
  if (!("dealId" in r)) throw new Error();
  dealId = r.dealId;
  contactId = (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, dealId)))[0].c;
});

describe("getContact", () => {
  it("não existe: null (e id inválido também)", async () => {
    expect(await getContact("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await getContact("nao-e-uuid")).toBeNull();
  });

  it("junta contato, todos os leads, mensagens, tarefas e eventos", async () => {
    await setNextAction(dealId, { title: "Ligar de volta", dueAt: new Date(Date.now() + 86_400_000), assigneeId: uid }, uid);
    const d = await getContact(contactId);
    expect(d?.contact.name).toBe("Mariana");
    expect(d?.deals.map((x) => x.id)).toEqual([dealId]);
    expect(d?.deals[0].open).toBe(true);
    expect(d?.messages.map((m) => m.body)).toEqual(["Oi, quero progressiva"]);
    expect(d?.tasks.map((t) => t.title)).toEqual(["Ligar de volta"]);
    expect(d?.events.some((e) => e.type === "lead_criado")).toBe(true);
    expect(d?.events.some((e) => e.type === "mensagem_recebida")).toBe(false); // a conversa já mostra
    expect(d?.origin).toBe("Não identificada");
  });

  it("leads anteriores (fechado e arquivado) aparecem junto com o aberto", async () => {
    const [svc] = await db.insert(lists).values({ kind: "service", label: "Progressiva" }).returning();
    await closeSale(dealId, { serviceId: svc.id, valueCents: 25000, paymentMethod: "pix", paidNow: true }, uid);
    const second = await startConversation(contactId, uid);
    const d = await getContact(contactId, { withValues: true });
    expect(d?.deals.map((x) => [x.id, x.open])).toEqual([[second.dealId, true], [dealId, false]]);
    expect(d?.values).toEqual({ sales: 1, totalCents: 25000 });
    await archiveDeals([second.dealId], uid);
    const after = await getContact(contactId);
    expect(after?.contact.ignored).toBe(true);
    expect(after?.deals.find((x) => x.id === second.dealId)?.archived).toBe(true);
  });

  it("valores só quando pedidos (gestão): sem isso nem o valor do lead sai", async () => {
    const [svc] = await db.insert(lists).values({ kind: "service", label: "Progressiva" }).returning();
    await closeSale(dealId, { serviceId: svc.id, valueCents: 25000, paymentMethod: "pix", paidNow: false }, uid);
    const d = await getContact(contactId);
    expect(d?.values).toBeNull();
    expect(d?.deals[0].valueCents).toBeNull();
  });

  it("mensagens: as últimas 200, em ordem de leitura, com o total", async () => {
    const base = Date.now() - 1_000_000;
    await db.insert(messages).values(Array.from({ length: 230 }, (_, i) => ({ contactId, dealId, direction: "in" as const, body: `m${i}`, createdAt: new Date(base + i * 1000) })));
    const d = await getContact(contactId);
    expect(d?.messages).toHaveLength(200);
    expect(d?.messageTotal).toBe(231);
    expect(d?.messages.at(-1)?.body).toBe("Oi, quero progressiva"); // a mais nova
    expect(d?.messages[0].body).toBe("m31"); // as 31 mais antigas ficaram de fora
    expect(d?.messages[0].createdAt.getTime()).toBeLessThan(d!.messages.at(-1)!.createdAt.getTime());
  });

  it("origem real vem do primeiro lead; sem ela, 'Não identificada'", async () => {
    await db.update(deals).set({ sourceLabel: "Instagram" }).where(eq(deals.id, dealId));
    expect((await getContact(contactId))?.origin).toBe("Instagram");
  });

  it("mapa de nomes para o histórico (dono, etapa)", async () => {
    await db.update(deals).set({ ownerId: uid }).where(eq(deals.id, dealId));
    const d = await getContact(contactId);
    expect(d?.lookup.users[uid]).toBe("Ana Souza");
    expect(Object.keys(d!.lookup.stages!).length).toBeGreaterThan(3);
    expect((await db.select().from(stages)).length).toBeGreaterThan(3);
    expect((await db.select().from(contacts)).length).toBe(1);
  });
});
