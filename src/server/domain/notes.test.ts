import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, deals, messages, outbox, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { addNote, notesOf } from "./notes";

let sara = "", cati = "", ex = "", dealId = "", contactId = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  [{ id: cati }] = await db.insert(users).values({ name: "Catarina Rocha", email: "cati@teste.local", role: "gestor", passwordHash: "x" }).returning();
  [{ id: ex }] = await db.insert(users).values({ name: "Ex Atendente", email: "ex@teste.local", role: "atendente", passwordHash: "x", active: false }).returning();
  const r = await recordInbound({ channelId: null, externalId: "N1", phoneRaw: "71999990001", pushName: "Cliente Teste", body: "Oi, quero marcar" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
});

describe("nota interna", () => {
  it("grava com a autora e aparece nas notas da cliente", async () => {
    await addNote({ dealId, body: "  Cliente prefere à tarde  " }, sara);
    const [n] = await notesOf(contactId);
    expect(n).toMatchObject({ body: "Cliente prefere à tarde", authorName: "Sara Lima", source: "crm", mentions: [] });
  });

  it("a cliente não vê: não cria mensagem, não entra na fila de envio, não mexe na espera nem na etapa", async () => {
    const [before] = await db.select().from(deals).where(eq(deals.id, dealId));
    await addNote({ dealId, body: "Troca de turno: falta mandar o preço" }, sara);
    const [after] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(after.awaitingReplySince?.toISOString()).toBe(before.awaitingReplySince?.toISOString());
    expect(after.stageId).toBe(before.stageId);
    expect(after.lastOutboundAt).toBeNull();
    expect((await db.select().from(messages)).filter((m) => m.direction === "out")).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("@ avisa a colega no sino; nunca a autora, quem saiu da equipe ou um id que não existe", async () => {
    const r = await addNote({ dealId, body: "@Catarina pode conferir o sinal?", mentions: [cati, sara, ex, "00000000-0000-4000-8000-000000000000"] }, sara);
    expect(r.notified).toBe(1);
    const list = await db.select().from(alerts).where(eq(alerts.type, "mencao"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ userId: cati, audience: "responsavel", dealId });
    expect(list[0].message).toBe("Sara te marcou numa nota sobre Cliente Teste: “@Catarina pode conferir o sinal?”");
    expect((await notesOf(contactId))[0].mentions).toEqual([cati]);
  });

  it("trecho longo no aviso é cortado em 80 caracteres", async () => {
    await addNote({ dealId, body: `@Catarina ${"a".repeat(200)}`, mentions: [cati] }, sara);
    const [a] = await db.select().from(alerts).where(eq(alerts.type, "mencao"));
    expect(a.message.endsWith("…”")).toBe(true);
  });

  it("nota vazia ou longa demais é recusada", async () => {
    await expect(addNote({ dealId, body: "   " }, sara)).rejects.toThrow(/Escreva a nota/);
    await expect(addNote({ dealId, body: "x".repeat(2001) }, sara)).rejects.toThrow(/máximo 2.000/);
  });
});
