// src/server/domain/authorship-backfill.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db";
import { contacts, dealEvents, deals, messages, profiles, stages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyBackfill, planBackfill, restoreBackfill, type BackfillBackup } from "./authorship-backfill";

const NOW = new Date("2026-10-15T15:00:00Z");
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
type U = typeof users.$inferSelect;
let sara: U, cati: U, n = 0;

const person = async (name: string, key: "atendente" | "gestao", signature: string) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, key));
  return (await db.insert(users).values({ name, email: `${name[0]}@c.com`, passwordHash: "x", role: key === "gestao" ? "gestor" : "atendente", profileId: p.id, signature }).returning())[0];
};
const conversa = async (o: { owner?: string | null; closed?: boolean } = {}) => {
  n++;
  const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+557199900${String(n).padStart(4, "0")}` }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, o.closed ? "fechado" : "atendimento"));
  return (await db.insert(deals).values({ contactId: c.id, stageId: st.id, ownerId: o.owner ?? null, closedAt: o.closed ? ago(40) : null }).returning())[0];
};
const saiu = (d: { id: string; contactId: string }, body: string | null, at: Date, kind = "text") =>
  db.insert(messages).values({ dealId: d.id, contactId: d.contactId, direction: "out", body, kind, fromPhone: true, createdAt: at });
const deal = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

/** a: Sara assinou · b: Cati assinou e depois mandou áudio · c: sem assinatura · d: da Sara, Cati respondeu · e: nome desconhecido · f: fechada e antiga. */
async function cenario() {
  const a = await conversa(); await saiu(a, "*SARA - CASA FIAES:*\nOi", ago(1));
  const b = await conversa(); await saiu(b, "*CATI - CASA FIAES:*\nOi", ago(1)); await saiu(b, null, ago(0.5), "audio");
  const c = await conversa(); await saiu(c, "Oi, tudo bem?", ago(1));
  const d = await conversa({ owner: sara.id }); await saiu(d, "*CATI - CASA FIAES:*\nOi", ago(1));
  const e = await conversa(); await saiu(e, "*MARIA - CASA FIAES:*\nOi", ago(2));
  const f = await conversa({ closed: true }); await saiu(f, "*SARA - CASA FIAES:*\nOi", ago(40));
  return { a, b, c, d, e, f };
}

beforeEach(async () => {
  n = 0; await resetDb();
  sara = await person("Sara Lima", "atendente", "SARA");
  cati = await person("Catarina Moura", "gestao", "CATI");
});

describe("acerto para trás pela assinatura", () => {
  it("ensaio: tabela dona × quem respondeu, antes e depois, sem gravar nada", async () => {
    const { a, b, d } = await cenario();
    const plan = await planBackfill({ days: 30, now: NOW });
    expect(plan.before).toEqual([
      { dona: "Sara", respondeu: "Cati", conversas: 1 },
      { dona: "Sem dono", respondeu: "ninguém / sem assinatura", conversas: 2 },
      { dona: "Sem dono", respondeu: "Cati", conversas: 1 },
      { dona: "Sem dono", respondeu: "Sara", conversas: 1 },
    ]);
    expect(plan.after).toEqual([
      { dona: "Cati", respondeu: "Cati", conversas: 1 },
      { dona: "Sara", respondeu: "Cati", conversas: 1 },
      { dona: "Sara", respondeu: "Sara", conversas: 1 },
      { dona: "Sem dono", respondeu: "ninguém / sem assinatura", conversas: 2 },
    ]);
    expect(plan.owners).toHaveLength(2);
    expect(plan.owners).toEqual(expect.arrayContaining([{ dealId: a.id, ownerId: sara.id }, { dealId: b.id, ownerId: cati.id }]));
    expect(plan.replies.map((r) => r.dealId).sort()).toEqual([a.id, b.id, d.id].sort());
    expect(plan.unknownSignatures).toEqual({ MARIA: 1 });
    expect(plan.messages).toHaveLength(6); // a, b (2), c, d, e — a f fica fora (fechada e de 40 dias)
    expect(plan.messages.filter((m) => m.sentByUserId)).toHaveLength(3);
    expect(await db.select().from(deals).where(isNull(deals.ownerId))).toHaveLength(5); // nada mudou
  });

  it("aplicar: backup antes, donas e autoras gravadas, segundo ensaio vazio; desfazer volta tudo", async () => {
    const { a, b, c, d } = await cenario();
    const plan = await planBackfill({ days: 30, now: NOW });
    let backup: BackfillBackup | null = null;
    expect(await applyBackfill(plan, async (bk) => { backup = bk; })).toEqual({ messages: 6, owners: 2, replies: 3 });
    expect((await deal(a.id)).ownerId).toBe(sara.id);
    expect(await deal(b.id)).toMatchObject({ ownerId: cati.id, lastReplyById: cati.id, lastReplyVia: "celular" });
    expect(await deal(d.id)).toMatchObject({ ownerId: sara.id, lastReplyById: cati.id });
    expect((await deal(c.id)).ownerId).toBeNull();
    expect(backup!.conversas).toHaveLength(3);
    expect(backup!.mensagens).toHaveLength(6);
    const ev = await db.select().from(dealEvents).where(eq(dealEvents.type, "assumiu"));
    expect(ev.map((e) => e.payload)).toEqual(expect.arrayContaining([expect.objectContaining({ motivo: "assinatura", migracao: true })]));
    const again = await planBackfill({ days: 30, now: NOW });
    expect([again.messages.length, again.owners.length, again.replies.length]).toEqual([0, 0, 0]);
    expect(again.before).toEqual(plan.after);

    expect(await restoreBackfill(backup!)).toEqual({ messages: 6, deals: 3 });
    expect((await deal(a.id)).ownerId).toBeNull();
    expect(await db.select().from(messages).where(isNotNull(messages.sentByUserId))).toHaveLength(0);
    expect(await db.select().from(dealEvents).where(eq(dealEvents.type, "assumiu"))).toHaveLength(0);
  });

  it("backup que falha ao gravar não aplica nada", async () => {
    await cenario();
    const plan = await planBackfill({ days: 30, now: NOW });
    await expect(applyBackfill(plan, async () => { throw new Error("disco cheio"); })).rejects.toThrow("disco cheio");
    expect(await db.select().from(deals).where(isNotNull(deals.ownerId))).toHaveLength(1); // só a d, que já era da Sara
    expect(await db.select().from(messages).where(isNotNull(messages.sentVia))).toHaveLength(0);
  });
});
