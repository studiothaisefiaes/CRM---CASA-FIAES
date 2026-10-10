import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
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
    const r = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 3600, urgency: "high" });
    return r.statusCode;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (typeof code === "number") return code;
    throw e;
  }
};

/** Envia o push dos alertas ainda não avisados. Marca `pushedAt` sempre, para não reprocessar. */
export async function sendPushForPendingAlerts(sender: PushSender = webPushSender): Promise<{ sent: number; failed: number }> {
  // Resolvidos antes do aviso saem da fila sem push.
  await db.update(alerts).set({ pushedAt: new Date() }).where(and(isNull(alerts.pushedAt), isNotNull(alerts.resolvedAt)));
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
    const payload = JSON.stringify({ title: "Lead esperando", body: a.message, url: a.dealId ? `/funil?lead=${a.dealId}` : "/funil" });
    for (const uid of targets) for (const s of byUser.get(uid) ?? []) {
      if (gone.has(s.endpoint)) { failed++; continue; }
      try {
        const status = await sender(s, payload);
        if (status >= 200 && status < 300) { sent++; ok.add(s.endpoint); }
        else { failed++; if (status === 404 || status === 410) gone.add(s.endpoint); }
      } catch { failed++; }
    }
  }
  if (gone.size) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, [...gone]));
  const okLive = [...ok].filter((e) => !gone.has(e));
  if (okLive.length) await db.update(pushSubscriptions).set({ lastOkAt: new Date() }).where(inArray(pushSubscriptions.endpoint, okLive));
  return { sent, failed };
}
