import { Pool } from "pg";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { channels, messages, webhookEvents } from "../db/schema";
import { env } from "../env";
import { ingestEvolution, MAX_ATTEMPTS, type EvoPayload } from "./webhook";

/** Uma mensagem como a Evolution guarda (tabela "Message"): o mesmo formato do `data` do webhook messages.upsert. */
export type StoredEvoMessage = {
  instance: string; key: { remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean; id?: string; senderPn?: string };
  pushName?: string | null; message?: Record<string, unknown> | null; messageType?: string | null; messageTimestamp: number; status?: string | null;
  /** Coluna própria na Evolution (chega como data.contextInfo no webhook): traz o anúncio de onde a cliente veio. */
  contextInfo?: Record<string, unknown> | null;
};

/**
 * Mudança de estado de outra mensagem (reação, edição/apagada, voto): reenviada fora de ordem, sobrescreveria uma mais nova que já entrou
 * (voto "remarcar" perdido por cima do "confirmo" que chegou depois; revisão 24/10). Fica de fora.
 */
const STATE_CHANGE = ["reactionMessage", "protocolMessage", "editedMessage", "pollUpdateMessage"];
function isStateChange(m: Record<string, unknown> | null | undefined): boolean {
  const inner = (m?.ephemeralMessage as { message?: Record<string, unknown> } | undefined)?.message ?? m;
  return !!inner && STATE_CHANGE.some((k) => k in inner);
}
/** De onde vêm as mensagens guardadas. `null`: sem acesso ao banco da Evolution (nada a conferir). */
export type StoredEvoSource = { recent(fromSec: number, toSec: number): Promise<StoredEvoMessage[] | null> };

const WINDOW_S = 6 * 3600;
/** As de agora ainda podem estar chegando pelo webhook. */
const SETTLE_S = 120;
const LIMIT = 2000;

let pool: Pool | null = null;
/** Só leitura no banco da Evolution (o mesmo EVOLUTION_DATABASE_URL do número oculto). Conversa individual só: sem grupo, status e canal. */
export const evolutionStore: StoredEvoSource = {
  async recent(fromSec, toSec) {
    const url = env().EVOLUTION_DATABASE_URL;
    if (!url) return null;
    pool ??= new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, query_timeout: 15_000 });
    const r = await pool.query<StoredEvoMessage>(`
      select i.name as instance, m.key, m."pushName", m.message, m."messageType", m."messageTimestamp", m.status, m."contextInfo"
      from evolution_api."Message" m join evolution_api."Instance" i on i.id = m."instanceId"
      where m."messageTimestamp" between $1 and $2
        and m.key->>'remoteJid' not like '%@g.us' and m.key->>'remoteJid' not like '%@broadcast' and m.key->>'remoteJid' not like '%@newsletter'
      order by m."messageTimestamp" limit ${LIMIT}`, [fromSec, toSec]);
    return r.rows;
  },
};

/**
 * Reconciliação depois de queda (22/10: o CRM ficou 16 min sem banco e os webhooks desse intervalo se perderam). A cada rodada confere
 * as mensagens que a Evolution guardou nas últimas 6 h (menos os 2 últimos minutos) e passa pelo caminho normal do webhook as que o CRM
 * nunca recebeu: nem mensagem gravada, nem evento com aquele id. Canal em modo quieto ou com histórico na fila espera: o histórico traz.
 * Reação, edição e voto ficam de fora (ver STATE_CHANGE).
 */
export async function reconcileMissedMessages(now = new Date(), src: StoredEvoSource = evolutionStore): Promise<{ checked: number; replayed: number; skipped: number }> {
  const toSec = Math.floor(now.getTime() / 1000) - SETTLE_S;
  const rows = await src.recent(toSec - WINDOW_S + SETTLE_S, toSec);
  if (!rows?.length) return { checked: 0, replayed: 0, skipped: 0 };

  const instances = [...new Set(rows.map((r) => r.instance))];
  const chs = await db.select({ instance: channels.instanceName, quietUntil: channels.quietUntil }).from(channels).where(inArray(channels.instanceName, instances));
  // Lote que esgotou as tentativas não conta (fica sem processed_at para sempre e desligaria a conferência do canal).
  const pendingHistory = new Set((await db.selectDistinct({ i: sql<string | null>`${webhookEvents.payload}->>'instance'` }).from(webhookEvents)
    .where(and(eq(webhookEvents.event, "messages.set"), isNull(webhookEvents.processedAt), lt(webhookEvents.attempts, MAX_ATTEMPTS)))).map((r) => r.i));
  const ready = new Set(chs.filter((c) => c.instance && !(c.quietUntil && c.quietUntil > now) && !pendingHistory.has(c.instance)).map((c) => c.instance!));
  const skipped = new Set(chs.map((c) => c.instance).filter((i): i is string => !!i && !ready.has(i)));

  const todo = rows.filter((r) => r.key?.id && ready.has(r.instance) && !isStateChange(r.message));
  const ids = todo.map((r) => r.key.id!);
  if (!ids.length) return { checked: rows.length, replayed: 0, skipped: skipped.size };
  const keyId = sql<string>`(${webhookEvents.payload} #>> '{data,key,id}')`;
  const [inMessages, inEvents] = await Promise.all([
    db.select({ id: messages.externalId }).from(messages).where(inArray(messages.externalId, ids)),
    db.select({ id: keyId }).from(webhookEvents).where(inArray(keyId, ids)),
  ]);
  const known = new Set([...inMessages, ...inEvents].map((r) => r.id));

  let replayed = 0;
  for (const r of todo) {
    if (known.has(r.key.id!)) continue;
    const { instance, ...data } = r;
    const res = await ingestEvolution({ event: "messages.upsert", instance, data: data as EvoPayload["data"] });
    if (!("duplicate" in res && res.duplicate)) replayed++;
  }
  return { checked: rows.length, replayed, skipped: skipped.size };
}
