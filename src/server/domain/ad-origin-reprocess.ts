import { and, asc, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { webhookEvents } from "../db/schema";
import { originOf, type EvoPayload } from "../whatsapp/webhook";
import { captureOrigin, type CaptureResult } from "./ad-origin";

/**
 * Reprocessar o que já chegou (scripts/origem-anuncio-reprocessar.ts): lê os eventos crus guardados (`webhook_events`, 14 dias) de
 * messages.upsert e messages.set e grava anúncio e porta de entrada nas conversas existentes, com a MESMA regra do webhook (`captureOrigin`):
 * só onde está vazio (idempotente). A porta e a origem só valem quando a mensagem é a primeira da cliente na conversa. Mensagem da Casa e
 * grupo ficam de fora; mensagem que não está no CRM conta em `semConversa`. Nada muda no evento (nem `processed_at`).
 * `dryRun`: cada gravação roda numa transação desfeita no fim (conta o que faria, não grava nada).
 */
export type ReprocessStats = { eventos: number; mensagens: number; semConversa: number; anuncios: number; portas: number; origens: number; anunciosVistos: number };

class DryRun extends Error { constructor(public r: CaptureResult) { super("dry-run"); } }
type Msg = { key?: { id?: string; fromMe?: boolean; remoteJid?: string }; contextInfo?: unknown; message?: unknown };

const EVENTS = sql`lower(replace(${webhookEvents.event}, '_', '.')) in ('messages.upsert', 'messages.set')`;
// Só os eventos que podem ter origem (o texto cru tem a chave do anúncio ou da porta).
const MAY_HAVE = sql`(${webhookEvents.payload}::text like '%externalAdReply%' or ${webhookEvents.payload}::text like '%entryPointConversion%' or ${webhookEvents.payload}::text like '%ctwaClid%')`;

export async function reprocessAdOrigins(opts: { dryRun: boolean; pageSize?: number }): Promise<ReprocessStats> {
  const st: ReprocessStats = { eventos: 0, mensagens: 0, semConversa: 0, anuncios: 0, portas: 0, origens: 0, anunciosVistos: 0 };
  const seen = new Set<string>();
  const size = opts.pageSize ?? 200;
  // Os ids primeiro, na ordem de chegada (o anúncio que chegou antes vence, como ao vivo); os eventos (que podem ser lotes grandes) aos poucos.
  const ids = (await db.select({ id: webhookEvents.id }).from(webhookEvents).where(and(EVENTS, MAY_HAVE))
    .orderBy(asc(webhookEvents.receivedAt), asc(webhookEvents.id))).map((r) => r.id);
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const byId = new Map((await db.select({ id: webhookEvents.id, payload: webhookEvents.payload }).from(webhookEvents).where(inArray(webhookEvents.id, chunk))).map((r) => [r.id, r]));
    const rows = chunk.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    for (const row of rows) {
      st.eventos++;
      const p = row.payload as EvoPayload;
      const list = (Array.isArray(p.data) ? p.data : p.data ? [p.data] : []) as Msg[];
      for (const d of list) {
        const jid = d.key?.remoteJid ?? "";
        if (!d.key?.id || d.key.fromMe || jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) continue;
        const origin = originOf(d as never);
        if (!origin.ad && !origin.entry) continue;
        st.mensagens++;
        if (origin.ad?.adId) seen.add(origin.ad.adId);
        // A mensagem no CRM e se ela é a primeira da cliente naquela conversa.
        const r = await db.execute(sql`select m.deal_id, m.created_at,
            not exists (select 1 from messages m2 where m2.deal_id = m.deal_id and m2.direction = 'in' and (m2.created_at, m2.id) < (m.created_at, m.id)) as first
          from messages m where m.external_id = ${d.key.id} and m.direction = 'in' and m.deal_id is not null limit 1`);
        const msg = r.rows[0] as { deal_id: string; created_at: string | Date; first: boolean } | undefined;
        if (!msg) { st.semConversa++; continue; }
        const input = { dealId: msg.deal_id, origin, first: msg.first, at: new Date(msg.created_at) };
        let res: CaptureResult;
        try {
          res = await db.transaction(async (tx) => {
            const x = await captureOrigin(input, tx);
            if (opts.dryRun) throw new DryRun(x);
            return x;
          });
        } catch (e) {
          if (!(e instanceof DryRun)) throw e;
          res = e.r;
        }
        if (res.ad) st.anuncios++;
        if (res.entry) st.portas++;
        if (res.label) st.origens++;
      }
    }
  }
  st.anunciosVistos = seen.size;
  return st;
}
