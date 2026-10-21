import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, messages, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyTaskAssigneeFix, defaultAssignee, fixSummary, planTaskAssigneeFix } from "./task-assignee";
import { createTask } from "./tasks";

beforeEach(async () => { await resetDb(); });

async function setup() {
  const [sara] = await db.insert(users).values({ name: "Sara Lima", email: "s@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [cati] = await db.insert(users).values({ name: "Catarina", email: "c@c.com", role: "gestor", passwordHash: "x" }).returning();
  const [saiu] = await db.insert(users).values({ name: "Ex", email: "x@c.com", role: "atendente", passwordHash: "x", active: false }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
  let n = 0;
  const lead = async (ownerId: string | null, lastBy?: string | null) => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+55719999300${n}` }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, ownerId }).returning();
    if (lastBy !== undefined) await db.insert(messages).values({ dealId: d.id, contactId: c.id, direction: "out", body: "oi", sentByUserId: lastBy, createdAt: new Date() });
    return { c, d };
  };
  const openTask = async (l: { c: { id: string }; d: { id: string } }, title = "Retomar contato") =>
    (await db.insert(tasks).values({ dealId: l.d.id, contactId: l.c.id, kind: "proxima_acao", title, dueAt: new Date() }).returning())[0];
  return { sara, cati, saiu, lead, openTask };
}

describe("para quem vai a tarefa sem responsável", () => {
  it("dona do lead; sem dona, quem respondeu por último; ninguém ativo, null", async () => {
    const { sara, cati, saiu, lead } = await setup();
    expect(await defaultAssignee(db, (await lead(sara.id, cati.id)).d.id)).toEqual({ id: sara.id, via: "dona" });
    expect(await defaultAssignee(db, (await lead(null, cati.id)).d.id)).toEqual({ id: cati.id, via: "ultima_resposta" });
    expect(await defaultAssignee(db, (await lead(null, saiu.id)).d.id)).toBeNull();
    expect(await defaultAssignee(db, (await lead(null)).d.id)).toBeNull();
    // Lote 1A: quem respondeu por último fica gravado na conversa (vale mesmo sem a mensagem com autora no banco)
    const l5 = await lead(null);
    await db.update(deals).set({ lastReplyById: cati.id, lastReplyVia: "celular" }).where(eq(deals.id, l5.d.id));
    expect(await defaultAssignee(db, l5.d.id)).toEqual({ id: cati.id, via: "ultima_resposta" });
  });
  it("tarefa nova sem responsável já nasce com quem respondeu (vale para gestão também)", async () => {
    const { cati, lead } = await setup();
    const l = await lead(null, cati.id);
    const t = await createTask({ dealId: l.d.id, contactId: l.c.id, kind: "proxima_acao", title: "Retomar", dueAt: new Date() }, cati.id);
    expect(t.assigneeId).toBe(cati.id);
  });
});

describe("correção das tarefas antigas (script)", () => {
  it("ensaio não grava; aplicar grava só onde ainda está vazio e leva o aviso junto; rodar de novo não muda nada", async () => {
    const { sara, cati, lead, openTask } = await setup();
    const a = await openTask(await lead(sara.id));
    const b = await openTask(await lead(null, cati.id));
    const c = await openTask(await lead(null));
    await db.insert(alerts).values({ dealId: b.dealId, audience: "gestao", type: "tarefa_vencendo", severity: "info", message: "m", dedupeKey: `task:${b.id}`, waitKey: `task:${b.id}` });
    const plan = await planTaskAssigneeFix();
    expect(plan.map((p) => [p.taskId, p.to, p.via])).toEqual(expect.arrayContaining([[a.id, sara.id, "dona"], [b.id, cati.id, "ultima_resposta"], [c.id, null, null]]));
    expect((await db.select().from(tasks)).every((t) => t.assigneeId === null)).toBe(true); // ensaio não grava
    expect(fixSummary(plan)).toEqual(expect.arrayContaining([
      { kind: "proxima_acao", para: "Sara Lima", via: "dona", n: 1 }, { kind: "proxima_acao", para: "Catarina", via: "última resposta", n: 1 },
      { kind: "proxima_acao", para: "(ninguém)", via: "sem destino", n: 1 },
    ]));
    expect(await applyTaskAssigneeFix(plan)).toBe(2);
    expect(await applyTaskAssigneeFix(plan)).toBe(0); // idempotente
    const [al] = await db.select().from(alerts).where(eq(alerts.waitKey, `task:${b.id}`));
    expect(al).toMatchObject({ userId: cati.id, audience: "responsavel" });
    expect((await planTaskAssigneeFix()).map((p) => p.taskId)).toEqual([c.id]); // conferência: só a sem destino continua vazia
  });
});
