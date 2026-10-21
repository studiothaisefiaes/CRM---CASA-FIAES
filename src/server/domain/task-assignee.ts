import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, messages, tasks, users } from "../db/schema";
import { clientLabel } from "../../lib/alert-copy";

type Q = Tx | typeof db;

/**
 * Para quem vai uma tarefa sem responsável: a dona do lead; sem dona, quem respondeu a cliente por último — primeiro o que o Lote 1A
 * grava na conversa (`last_reply_by_id`: pessoa logada no CRM ou assinatura do celular), depois a última mensagem enviada com autora.
 * Só gente ativa. Ninguém: null (o aviso da tarefa cai na gestão).
 */
export async function defaultAssignee(q: Q, dealId: string): Promise<{ id: string; via: "dona" | "ultima_resposta" } | null> {
  const [owner] = await q.select({ id: users.id }).from(deals).innerJoin(users, eq(users.id, deals.ownerId)).where(and(eq(deals.id, dealId), eq(users.active, true)));
  if (owner) return { id: owner.id, via: "dona" };
  const [replied] = await q.select({ id: users.id }).from(deals).innerJoin(users, eq(users.id, deals.lastReplyById)).where(and(eq(deals.id, dealId), eq(users.active, true)));
  if (replied) return { id: replied.id, via: "ultima_resposta" };
  const [last] = await q.select({ id: users.id }).from(messages).innerJoin(users, eq(users.id, messages.sentByUserId))
    .where(and(eq(messages.dealId, dealId), eq(messages.direction, "out"), eq(users.active, true))).orderBy(desc(messages.createdAt), desc(messages.id)).limit(1);
  return last ? { id: last.id, via: "ultima_resposta" } : null;
}

export type AssigneeFix = { taskId: string; kind: string; title: string; client: string; dueAt: string; to: string | null; toName: string | null; via: "dona" | "ultima_resposta" | null };

/** Ensaio: as tarefas abertas sem responsável e para quem cada uma iria. Não grava nada. */
export async function planTaskAssigneeFix(): Promise<AssigneeFix[]> {
  const open = await db.select({ id: tasks.id, kind: tasks.kind, title: tasks.title, dueAt: tasks.dueAt, dealId: tasks.dealId, name: contacts.name, phone: contacts.phoneE164 })
    .from(tasks).innerJoin(contacts, eq(contacts.id, tasks.contactId)).where(and(isNull(tasks.doneAt), isNull(tasks.assigneeId))).orderBy(asc(tasks.dueAt));
  const names = new Map((await db.select({ id: users.id, name: users.name }).from(users)).map((u) => [u.id, u.name]));
  const out: AssigneeFix[] = [];
  for (const t of open) {
    const to = t.dealId ? await defaultAssignee(db, t.dealId) : null;
    out.push({ taskId: t.id, kind: t.kind, title: t.title, client: clientLabel(t.name, t.phone), dueAt: t.dueAt.toISOString(), to: to?.id ?? null, toName: to ? names.get(to.id) ?? null : null, via: to?.via ?? null });
  }
  return out;
}

/** Aplica o ensaio: só onde ainda está sem responsável e aberta (idempotente). O aviso aberto da tarefa vai junto para a pessoa. */
export async function applyTaskAssigneeFix(plan: AssigneeFix[]): Promise<number> {
  let n = 0;
  await db.transaction(async (tx) => {
    for (const f of plan) {
      if (!f.to) continue;
      const r = await tx.update(tasks).set({ assigneeId: f.to }).where(and(eq(tasks.id, f.taskId), isNull(tasks.assigneeId), isNull(tasks.doneAt))).returning({ id: tasks.id });
      if (!r.length) continue;
      n++;
      await tx.update(alerts).set({ userId: f.to, audience: "responsavel", readAt: null, pushedAt: null }).where(and(eq(alerts.waitKey, `task:${f.taskId}`), isNull(alerts.resolvedAt)));
    }
  });
  return n;
}

/** A tabela do ensaio: por tipo de tarefa, quantas vão para cada pessoa e por quê. */
export function fixSummary(plan: AssigneeFix[]): { kind: string; para: string; via: string; n: number }[] {
  const m = new Map<string, { kind: string; para: string; via: string; n: number }>();
  for (const f of plan) {
    const para = f.toName ?? "(ninguém)", via = f.via === "dona" ? "dona" : f.via === "ultima_resposta" ? "última resposta" : "sem destino";
    const k = `${f.kind}|${para}|${via}`;
    const row = m.get(k) ?? { kind: f.kind, para, via, n: 0 };
    row.n++; m.set(k, row);
  }
  return [...m.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.n - a.n);
}
