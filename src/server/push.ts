import { and, eq, inArray, isNotNull, isNull, like, or } from "drizzle-orm";
import webpush from "web-push";
import { db } from "./db";
import { alerts, pushSubscriptions, users } from "./db/schema";
import { vapidConfig } from "./env";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
/** Envia um payload (JSON em texto) e devolve o status HTTP do serviço de push. Pode lançar em erro de rede. */
export type PushSender = (sub: PushTarget, payload: string) => Promise<number>;

/** Alerta mais velho que isso é marcado como enviado sem push (evita avalanche ao ligar o recurso). */
const FRESH_MS = 2 * 3600_000;

let configured = false;
/** Sender de verdade (web-push). Só roda com as chaves VAPID; os testes sempre injetam o deles. */
export const webPushSender: PushSender = async (sub, payload) => {
  const v = vapidConfig();
  if (!v) throw new Error("Push desligado: faltam as chaves VAPID.");
  if (!configured) { webpush.setVapidDetails(v.subject, v.publicKey, v.privateKey); configured = true; }
  try {
    const r = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: "high", timeout: 10_000 });
    return r.statusCode;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (typeof code === "number") return code;
    throw e;
  }
};

/** Envia o push dos alertas ainda não avisados. Marca `pushedAt` sempre, para não reprocessar. */
export async function sendPushForPendingAlerts(sender: PushSender = webPushSender): Promise<{ sent: number; failed: number }> {
  // Saem da fila sem push: resolvidos antes do aviso e tudo que não é alerta de espera
  // (sem wait_key, ou lembrete de tarefa, cuja wait_key é "task:<id>"): ficam só no sistema.
  await db.update(alerts).set({ pushedAt: new Date() }).where(and(isNull(alerts.pushedAt),
    or(isNotNull(alerts.resolvedAt), isNull(alerts.waitKey), like(alerts.waitKey, "task:%"))));
  const pending = await db.select().from(alerts).where(and(isNull(alerts.pushedAt), isNull(alerts.resolvedAt)));
  if (!pending.length) return { sent: 0, failed: 0 };

  const managers = (await db.select({ id: users.id }).from(users).where(and(eq(users.role, "gestor"), eq(users.active, true)))).map((u) => u.id);
  const userIds = [...new Set([...managers, ...pending.map((a) => a.userId).filter((x): x is string => !!x)])];
  const subs = userIds.length ? await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds)) : [];
  const byUser = new Map<string, typeof subs>();
  for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);

  let sent = 0, failed = 0;
  const gone = new Set<string>();
  const ok = new Set<string>();
  for (const a of pending) {
    const claimed = await db.update(alerts).set({ pushedAt: new Date() }).where(and(eq(alerts.id, a.id), isNull(alerts.pushedAt))).returning({ id: alerts.id });
    if (!claimed.length) continue; // outra rodada já pegou
    if (Date.now() - (a.escalatedAt ?? a.createdAt).getTime() > FRESH_MS) continue;
    const toManagers = a.level >= 2 || (a.audience === "gestao" && !a.userId);
    const targets = toManagers ? managers : a.userId ? [a.userId] : [];
    const title = a.level >= 2 ? "Atraso escalado para a gestão" : "Lead esperando";
    const payload = JSON.stringify({ title, body: a.message, url: a.dealId ? `/funil?lead=${a.dealId}` : "/funil" });
    const subsOf = targets.flatMap((uid) => byUser.get(uid) ?? []).filter((s) => !gone.has(s.endpoint));
    // Em paralelo: um endpoint lento ou fora do ar não segura os outros aparelhos.
    const results = await Promise.allSettled(subsOf.map((s) => sender(s, payload)));
    results.forEach((res, i) => {
      const status = res.status === "fulfilled" ? res.value : 0;
      if (status >= 200 && status < 300) { sent++; ok.add(subsOf[i].endpoint); }
      else { failed++; if (status === 404 || status === 410) gone.add(subsOf[i].endpoint); }
    });
  }
  if (gone.size) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, [...gone]));
  const okLive = [...ok].filter((e) => !gone.has(e));
  if (okLive.length) await db.update(pushSubscriptions).set({ lastOkAt: new Date() }).where(inArray(pushSubscriptions.endpoint, okLive));
  return { sent, failed };
}
