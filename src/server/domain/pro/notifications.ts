import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { professionals, proNotifications, pushSubscriptions, users } from "../../db/schema";
import { effectiveRanges, type WorkHours } from "@/lib/work-hours";
import { holdUntil, leaveDecisionDraft, notifyDedupeKey, planProNotifications, SILENT_VIA, type AgendaChange, type NotifyDraft } from "@/lib/pro-notify";
import { getBusinessHours } from "../hours";
import { getProAppSettings } from "./settings";
import { webPushSender, type PushSender } from "../../push";
import type { ProContext } from "../../queries/pro";

/** Aviso que passou mais de 2 h da hora em que podia sair é marcado sem push (evita avalanche quando o push é ligado depois). */
export const PUSH_FRESH_MS = 2 * 3_600_000;
const HISTORY_MS = 48 * 3_600_000;

async function insertDraftsTx(tx: Tx, drafts: NotifyDraft[], ctx: { actorId: string | null; now: Date; ref: (d: NotifyDraft) => string }): Promise<number> {
  if (!drafts.length) return 0;
  const ids = [...new Set(drafts.map((d) => d.professionalId))];
  const [pros, casa] = await Promise.all([
    tx.select({ id: professionals.id, userId: professionals.userId, workHours: professionals.workHours, active: professionals.active, userActive: users.active })
      .from(professionals).leftJoin(users, eq(users.id, professionals.userId)).where(inArray(professionals.id, ids)),
    getBusinessHours(tx),
  ]);
  const byId = new Map(pros.map((p) => [p.id, p]));
  let n = 0;
  for (const d of drafts) {
    const p = byId.get(d.professionalId);
    // Sem acesso ao app, desativada, ou foi ela mesma quem mudou: não avisa.
    if (!p?.userId || !p.active || !p.userActive || p.userId === ctx.actorId) continue;
    const hold = d.noHold ? null : holdUntil(ctx.now.getTime(), (day) => effectiveRanges(day, (p.workHours as WorkHours | null) ?? null, casa));
    const rows = await tx.insert(proNotifications).values({
      userId: p.userId, professionalId: d.professionalId, kind: d.kind, appointmentId: d.appointmentId, title: d.title, body: d.body, url: d.url,
      dedupeKey: notifyDedupeKey({ ref: ctx.ref(d), kind: d.kind, professionalId: d.professionalId }, ctx.now), holdUntil: hold, createdAt: ctx.now,
    }).onConflictDoNothing({ target: proNotifications.dedupeKey }).returning({ id: proNotifications.id });
    n += rows.length;
  }
  return n;
}

/**
 * Gancho das portas do 6B (mesma transação da mudança): o que mudou na agenda vira aviso para a profissional.
 * Importação do Avec, script e migração não avisam (SILENT_VIA). Devolve quantos avisos novos entraram.
 */
export async function queueProNotificationsTx(tx: Tx, change: AgendaChange, ctx: { actorId: string | null; via: string; now?: Date }): Promise<number> {
  if (SILENT_VIA.has(ctx.via)) return 0;
  const now = ctx.now ?? new Date();
  const names = change.kind === "remarcado" && change.after.professionalId
    ? Object.fromEntries((await tx.select({ id: professionals.id, name: professionals.name }).from(professionals).where(eq(professionals.id, change.after.professionalId))).map((p) => [p.id, p.name]))
    : {};
  const cfg = await getProAppSettings(tx);
  return insertDraftsTx(tx, planProNotifications(change, { names, avisaConfirmacao: cfg.avisaConfirmacao }), { actorId: ctx.actorId, now, ref: (d) => d.appointmentId ?? "-" });
}

/** Pedido de folga decidido: avisa a profissional (Tarefa 7A.8). */
export async function queueLeaveNotificationTx(tx: Tx, i: { professionalId: string; blockId: string; approved: boolean; period: string; note: string | null; actorId: string; now: Date }): Promise<number> {
  return insertDraftsTx(tx, [leaveDecisionDraft(i)], { actorId: i.actorId, now: i.now, ref: () => `folga-${i.blockId}` });
}

/** Job `push-agenda` (worker, a cada minuto): manda o que já pode sair para todos os aparelhos dela. Endereço 404/410 sai, como no push dos alertas. */
export async function sendPendingProNotifications(sender: PushSender = webPushSender, now = new Date()): Promise<{ sent: number; failed: number; skipped: number }> {
  const due = await db.select().from(proNotifications)
    .where(and(isNull(proNotifications.pushedAt), or(isNull(proNotifications.holdUntil), lte(proNotifications.holdUntil, now))))
    .orderBy(asc(proNotifications.createdAt)).limit(200);
  if (!due.length) return { sent: 0, failed: 0, skipped: 0 };
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, [...new Set(due.map((n) => n.userId))]));
  let sent = 0, failed = 0, skipped = 0;
  const gone = new Set<string>(), ok = new Set<string>();
  for (const n of due) {
    const claimed = await db.update(proNotifications).set({ pushedAt: now }).where(and(eq(proNotifications.id, n.id), isNull(proNotifications.pushedAt))).returning({ id: proNotifications.id });
    if (!claimed.length) continue; // outra rodada já pegou
    if (now.getTime() - (n.holdUntil ?? n.createdAt).getTime() > PUSH_FRESH_MS) { skipped++; continue; }
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url });
    const targets = subs.filter((s) => s.userId === n.userId && !gone.has(s.endpoint));
    const results = await Promise.allSettled(targets.map((s) => sender(s, payload)));
    results.forEach((r, i) => {
      const status = r.status === "fulfilled" ? r.value : 0;
      if (status >= 200 && status < 300) { sent++; ok.add(targets[i].endpoint); }
      else { failed++; if (status === 404 || status === 410) gone.add(targets[i].endpoint); }
    });
  }
  if (gone.size) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, [...gone]));
  const live = [...ok].filter((e) => !gone.has(e));
  if (live.length) await db.update(pushSubscriptions).set({ lastOkAt: now }).where(inArray(pushSubscriptions.endpoint, live));
  return { sent, failed, skipped };
}

export type ProNotificationItem = { id: string; title: string; body: string; url: string; at: string; read: boolean };

/** Avisos das últimas 48 h (para quando o aviso no celular não chegar). */
export async function listMyNotifications(pro: ProContext, now = new Date()): Promise<ProNotificationItem[]> {
  const rows = await db.select().from(proNotifications)
    .where(and(eq(proNotifications.userId, pro.userId), gte(proNotifications.createdAt, new Date(now.getTime() - HISTORY_MS)), lte(proNotifications.createdAt, now)))
    .orderBy(desc(proNotifications.createdAt)).limit(100);
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, url: r.url, at: r.createdAt.toISOString(), read: !!r.readAt }));
}

export async function markNotificationsRead(pro: ProContext, now = new Date()): Promise<number> {
  return (await db.update(proNotifications).set({ readAt: now }).where(and(eq(proNotifications.userId, pro.userId), isNull(proNotifications.readAt))).returning({ id: proNotifications.id })).length;
}

export async function unreadCount(pro: ProContext, now = new Date()): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(proNotifications)
    .where(and(eq(proNotifications.userId, pro.userId), isNull(proNotifications.readAt), gte(proNotifications.createdAt, new Date(now.getTime() - HISTORY_MS))));
  return r?.n ?? 0;
}

/** O aviso de teste da tela Instalar: sai na hora para os aparelhos dela. */
export async function sendTestPush(userId: string, sender: PushSender = webPushSender): Promise<{ sent: number; devices: number }> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const payload = JSON.stringify({ title: "Avisos ligados", body: "Pronto! Os horários novos, remarcados e cancelados vão chegar aqui.", url: "/pro/avisos" });
  const r = await Promise.allSettled(subs.map((s) => sender(s, payload)));
  return { sent: r.filter((x) => x.status === "fulfilled" && x.value >= 200 && x.value < 300).length, devices: subs.length };
}
