import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { daysCountingOpenDays, isOpen, type BusinessHours } from "@/lib/business-hours";
import { db, type Tx } from "../db";
import { alerts } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";
import { getBusinessHours } from "./hours";
import { emit } from "./events";

type Who = Pick<SessionUser, "id" | "perms">;
/** Os avisos que esta pessoa vê no sino: os dela e, para quem recebe escaladas, os da gestão. */
export const alertsOf = (user: Who) => (can(user.perms, "alertas.escalada") ? or(eq(alerts.userId, user.id), eq(alerts.audience, "gestao")) : eq(alerts.userId, user.id));
/** Espera em aberto (`<lead>:<instante>`): some só quando alguém responde, nunca pelo sino. Tarefa (`task:`) e oferta (`oferta:`) resolvem. */
export const isWaitAlertKey = (k: string | null | undefined): boolean => !!k && !k.startsWith("task:") && !k.startsWith("oferta:");

/** "Resolver" no sino: a pessoa já cuidou. Só avisos que ela vê e que não são espera. Devolve quantos resolveu. */
export async function resolveAlerts(user: Who, ids: string[], now = new Date()): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(alertsOf(user), inArray(alerts.id, ids), isNull(alerts.resolvedAt), or(isNull(alerts.waitKey), like(alerts.waitKey, "task:%"), like(alerts.waitKey, "oferta:%"))))
    .returning({ id: alerts.id });
  return rows.length;
}

/* ---------- Fadiga de alerta (pesquisa de 20/10: Ancker 2017, Cvach 2012) ----------
 * O que cansa é o MESMO aviso repetido e o aviso que não serve mais. Por isso:
 * - no máximo um aviso aberto por conversa e por motivo (`hasOpenAlert`: quem cria confere antes);
 * - o aviso sobe em degraus, sem repetir: selo (dourado) → destaque vermelho → aviso à gestão;
 * - o que deixou de valer sai sozinho (conversa resolvida, arquivada, encerrada, que mudou de etapa ou ganhou próximo passo);
 * - som só para "a cliente escreveu" (ver components/shell/sound.ts).
 */

/** Motivos que sobem em degraus (os que se acumulavam: 97 combinados e 51 paradas em 7 dias, 20/10). A espera tem a escada dela (engine.ts). */
export const LADDER_TYPES = ["tarefa_vencendo", "parado_dias"] as const;
/** Dias de expediente com o aviso aberto para ficar vermelho e para subir para a gestão. */
export const LADDER_RED_DAYS = 1;
export const LADDER_GESTAO_DAYS = 2;

/**
 * Já existe aviso aberto desta conversa por este motivo? Quem cria um aviso que não é de espera confere antes (nunca dois iguais).
 * `keyPrefix`: o motivo é a regra (duas automações diferentes com o mesmo gatilho são dois motivos); a chave do aviso começa por ela.
 */
export async function hasOpenAlert(tx: Tx | typeof db, dealId: string | null | undefined, type: string, keyPrefix?: string): Promise<boolean> {
  if (!dealId) return false;
  const [row] = await tx.select({ id: alerts.id }).from(alerts)
    .where(and(eq(alerts.dealId, dealId), eq(alerts.type, type), isNull(alerts.resolvedAt), keyPrefix ? like(alerts.dedupeKey, `${keyPrefix}%`) : undefined)).limit(1);
  return !!row;
}

/** Avisos que não são de espera (sem wait_key, ou lembrete de combinado `task:`): os de espera se resolvem com a resposta. */
const notWait = sql`(${alerts.waitKey} is null or ${alerts.waitKey} like 'task:%')`;

export type AlertSweep = { duplicates: number; stale: number; red: number; gestao: number };

/**
 * Worker, a cada 5 min (junto dos lembretes), só com a Casa aberta:
 * 1. repetidos: se a mesma conversa tem mais de um aviso aberto pelo mesmo motivo (legado), fica só o mais novo;
 * 2. "parada" que não vale mais: a conversa foi resolvida, arquivada, encerrada, mudou de etapa ou ganhou próximo passo marcado;
 * 3. degraus: 1 dia de expediente aberto → vermelho; 2 dias → também para a gestão. Nunca volta a "não lido" nem cria outro aviso.
 */
export async function sweepAlerts(now = new Date(), hours?: BusinessHours): Promise<AlertSweep> {
  const out: AlertSweep = { duplicates: 0, stale: 0, red: 0, gestao: 0 };
  const bh = hours ?? (await getBusinessHours());
  if (!isOpen(now.getTime(), bh)) return out;
  const nowIso = now.toISOString();
  const touched = new Set<string>();
  const done = { resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${nowIso}::timestamptz)` };

  // 1. Repetidos do mesmo motivo (o mesmo combinado-aviso, ou a mesma regra: a chave começa pelo id dela) na mesma conversa: fica o mais novo.
  const dup = await db.update(alerts).set(done).where(and(isNull(alerts.resolvedAt), notWait, sql`${alerts.dealId} is not null`,
    sql`exists (select 1 from alerts b where b.deal_id = ${alerts.dealId} and b.type = ${alerts.type} and b.resolved_at is null
      and (b.type = 'tarefa_vencendo' or split_part(b.dedupe_key, ':', 1) = split_part(${alerts.dedupeKey}, ':', 1))
      and (b.wait_key is null or b.wait_key like 'task:%') and (b.created_at, b.id) > (${alerts.createdAt}, ${alerts.id}))`))
    .returning({ dealId: alerts.dealId });
  out.duplicates = dup.length;
  dup.forEach((r) => r.dealId && touched.add(r.dealId));

  // 2. "Parada" que deixou de valer.
  const stale = await db.update(alerts).set(done).where(and(isNull(alerts.resolvedAt), eq(alerts.type, "parado_dias"),
    sql`exists (select 1 from deals d where d.id = ${alerts.dealId} and (d.archived_at is not null or d.conversation_archived_at is not null
      or d.closed_at is not null or d.stage_entered_at > ${alerts.createdAt}
      or exists (select 1 from tasks t where t.deal_id = d.id and t.done_at is null and t.due_at > ${nowIso}::timestamptz)))`))
    .returning({ dealId: alerts.dealId });
  out.stale = stale.length;
  stale.forEach((r) => r.dealId && touched.add(r.dealId));

  // 3. Degraus.
  const open = await db.select({ id: alerts.id, dealId: alerts.dealId, createdAt: alerts.createdAt, severity: alerts.severity, level: alerts.level }).from(alerts)
    .where(and(isNull(alerts.resolvedAt), inArray(alerts.type, [...LADDER_TYPES]), sql`${alerts.createdAt} > ${new Date(now.getTime() - 14 * 86_400_000).toISOString()}::timestamptz`));
  for (const a of open) {
    const days = daysCountingOpenDays(a.createdAt.getTime(), now.getTime(), bh);
    if (days >= LADDER_GESTAO_DAYS && a.level < 2) {
      // A dona continua vendo (userId fica); a gestão passa a ver em "Para a gestão". Sem push (não é espera) e sem voltar a "não lido".
      await db.update(alerts).set({ level: 2, severity: "urgente", audience: "gestao", escalatedAt: now }).where(eq(alerts.id, a.id));
      out.gestao++;
      if (a.dealId) touched.add(a.dealId);
    } else if (days >= LADDER_RED_DAYS && a.severity !== "urgente") {
      await db.update(alerts).set({ severity: "urgente" }).where(eq(alerts.id, a.id));
      out.red++;
      if (a.dealId) touched.add(a.dealId);
    }
  }
  if (touched.size) await emit("regras", { deals: [...touched].slice(0, 50) });
  return out;
}
