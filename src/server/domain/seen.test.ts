import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, stages, users } from "../db/schema";
import { markSeen } from "./seen";
import { resetDb } from "../../../test/db";

beforeEach(async () => { await resetDb(); });

const seenOf = async (id: string) => (await db.select({ s: deals.seenAt }).from(deals).where(eq(deals.id, id)))[0].s;
async function setup(owner: "ana" | null) {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "gestor", passwordHash: "x" }).returning();
  const [st] = await db.select().from(stages).limit(1);
  const [c] = await db.insert(contacts).values({ name: "Cli", phoneE164: "+5571999990001" }).returning();
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, ownerId: owner === "ana" ? ana.id : null }).returning();
  return { ana, bia, d };
}

describe("markSeen: abrir a conversa tira as não lidas (como no WhatsApp)", () => {
  it("quem abrir marca como vista, mesmo não sendo a dona (a conversa aberta é conversa lida)", async () => {
    const { bia, d } = await setup("ana");
    await markSeen(d.id, bia.id);
    expect(await seenOf(d.id)).toBeInstanceOf(Date);
  });

  it("mensagem nova depois de aberta volta a contar; abrir de novo zera", async () => {
    const { ana, d } = await setup("ana");
    await markSeen(d.id, ana.id, new Date("2026-10-15T12:00:00Z"));
    await db.update(deals).set({ lastInboundAt: new Date("2026-10-15T12:01:00Z") }).where(eq(deals.id, d.id));
    await markSeen(d.id, ana.id, new Date("2026-10-15T12:02:00Z"));
    expect((await seenOf(d.id))!.toISOString()).toBe("2026-10-15T12:02:00.000Z");
  });

  it("abrir de novo sem mensagem nova não mexe (nem avisa as outras telas)", async () => {
    const { ana, d } = await setup("ana");
    const first = new Date("2026-10-15T12:00:00Z");
    await markSeen(d.id, ana.id, first);
    await markSeen(d.id, ana.id, new Date("2026-10-15T12:05:00Z"));
    expect((await seenOf(d.id))!.toISOString()).toBe(first.toISOString());
    await db.update(deals).set({ lastInboundAt: new Date("2026-10-15T12:06:00Z") }).where(eq(deals.id, d.id));
    await markSeen(d.id, ana.id, new Date("2026-10-15T12:07:00Z"));
    expect((await seenOf(d.id))!.toISOString()).toBe("2026-10-15T12:07:00.000Z");
  });

  it("sem dona, quem abrir marca como vista", async () => {
    const { bia, d } = await setup(null);
    await markSeen(d.id, bia.id);
    expect(await seenOf(d.id)).toBeInstanceOf(Date);
  });
});
