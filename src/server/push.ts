import { and, eq, inArray, isNotNull, isNull, like, notInArray, or, sql } from "drizzle-orm";
import webpush from "web-push";
import { db } from "./db";
import { alerts, profiles, pushSubscriptions, users } from "./db/schema";
import { vapidConfig } from "./env";
import { leadHref } from "../lib/lead-href";
import { CLIENT_MESSAGE_ALERT } from "./domain/client-message-alert";
import { CLIENT_MESSAGE_TITLE } from "../lib/client-notice";

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

/** Falha passageira do serviço de push (5xx, 429 ou erro de rede): espera um pouco e tenta mais uma vez. 404/410 (inscrição morta) não repete. */
export function retryPush(sender: PushSender, delayMs = 1_500): PushSender {
  const passageira = (s: number) => s >= 500 || s === 429;
  return async (sub, payload) => {
    const first = await sender(sub, payload).then((s) => s, () => 0);
    if (first !== 0 && !passageira(first)) return first;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return sender(sub, payload);
  };
}

/** Avisos sem espera que também vão por push (o resto fica só no sino). */
export const PUSH_ALSO: readonly string[] = ["mencao", "agendada_falhou", "mensagem_cliente", "link_remarcar"];
const PUSH_TITLE: Record<string, string> = { mencao: "Te marcaram numa nota", agendada_falhou: "Mensagem agendada não saiu", mensagem_cliente: CLIENT_MESSAGE_TITLE, link_remarcar: "Cliente pediu para remarcar" };

/** Envia o push dos alertas ainda não avisados. Marca `pushedAt` sempre, para não reprocessar. */
export async function sendPushForPendingAlerts(sender: PushSender = webPushSender, opts: { retryDelayMs?: number } = {}): Promise<{ sent: number; failed: number }> {
  const send = retryPush(sender, opts.retryDelayMs);
  // Saem da fila sem push: resolvidos antes do aviso e tudo que não é alerta de espera
  // (sem wait_key, ou lembrete de tarefa, cuja wait_key é "task:<id>"): ficam só no sistema.
  // Exceção: os tipos de PUSH_ALSO (menção numa nota…) vão por push mesmo sem espera.
  await db.update(alerts).set({ pushedAt: new Date() }).where(and(isNull(alerts.pushedAt),
    or(isNotNull(alerts.resolvedAt), and(isNull(alerts.waitKey), notInArray(alerts.type, [...PUSH_ALSO])), like(alerts.waitKey, "task:%"))));
  const pending = await db.select().from(alerts).where(and(isNull(alerts.pushedAt), isNull(alerts.resolvedAt)));
  if (!pending.length) return { sent: 0, failed: 0 };

  // Escalada (alerta da gestão) vai para quem tem "Receber escaladas" no perfil.
  const managers = (await db.select({ id: users.id }).from(users).innerJoin(profiles, eq(profiles.id, users.profileId))
    .where(and(eq(users.active, true), sql`${profiles.permissions} @> array['alertas.escalada']::text[]`))).map((u) => u.id);
  // "Fulana escreveu" vai para toda a equipe que enxerga a conversa (Cati 24/10: só a dona recebia): quem vê as das outras e,
  // na conversa sem dona, também quem vê só as suas e as sem dona.
  const team = pending.some((a) => a.type === CLIENT_MESSAGE_ALERT)
    ? await db.select({ id: users.id, todas: sql<boolean>`${profiles.permissions} @> array['atendimento.todas']::text[]` }).from(users).innerJoin(profiles, eq(profiles.id, users.profileId))
      .where(and(eq(users.active, true), sql`${profiles.permissions} @> array['atendimento.ver']::text[]`))
    : [];
  const userIds = [...new Set([...managers, ...team.map((u) => u.id), ...pending.map((a) => a.userId).filter((x): x is string => !!x)])];
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
    const targets = a.type === CLIENT_MESSAGE_ALERT
      ? [...new Set([...(a.userId ? [a.userId] : []), ...team.filter((u) => u.todas || !a.userId).map((u) => u.id)])]
      : toManagers ? managers : a.userId ? [a.userId] : [];
    const title = PUSH_TITLE[a.type] ?? (a.level >= 2 ? "Atraso escalado para a gestão" : "Conversa esperando");
    const payload = JSON.stringify({ title, body: a.message, url: leadHref(a.dealId) });
    const subsOf = targets.flatMap((uid) => byUser.get(uid) ?? []).filter((s) => !gone.has(s.endpoint));
    // Em paralelo: um endpoint lento ou fora do ar não segura os outros aparelhos.
    const results = await Promise.allSettled(subsOf.map((s) => send(s, payload)));
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
