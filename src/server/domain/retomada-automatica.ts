import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { outbox } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { funcaoLigada, funcaoParam } from "./funcoes";
import { getBusinessHours } from "./hours";
import { iaPlaceholder, scheduleMessage } from "./scheduled";

const POR_RODADA = 3;
const AHEAD_MS = 6 * 60_000; // o agendamento pede pelo menos 5 min

/**
 * Retomada automática das vencidas (Cati 31/10): usa o mesmo envio da Retomada pela IA, ligado à tarefa (saiu → feita; a cliente escreveu → cancelada).
 * Poucas por rodada e limite de 24 h, começando pelas que venceram há menos tempo. Sem dona ou responsável ativa, não sai (ninguém para assinar).
 */
export async function sweepRetomadaAutomatica(now = new Date()): Promise<number> {
  if (!(await funcaoLigada("retomada_automatica")) || !(await funcaoLigada("retomada_ia"))) return 0;
  if (!isOpen(now.getTime(), await getBusinessHours())) return 0;
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from outbox where options ? 'retomadaAuto' and created_at >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz and status <> 'cancelled'`)).rows;
  const vagas = Math.min(POR_RODADA, (await funcaoParam("retomada_automatica", "max_dia")) - n);
  if (vagas <= 0) return 0;
  const desde = new Date(now.getTime() - (await funcaoParam("retomada_automatica", "dias_max")) * 86_400_000);
  const rows = (await db.execute<{ task_id: string; deal_id: string; title: string; author: string }>(sql`
    select t.id task_id, d.id deal_id, t.title, u.id author
    from tasks t join deals d on d.id = t.deal_id join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id
    join users u on u.id = coalesce(t.assignee_id, d.owner_id) and u.active
    where t.kind = 'proxima_acao' and t.done_at is null and t.due_at < ${now.toISOString()}::timestamptz and t.due_at >= ${desde.toISOString()}::timestamptz
      and d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null and d.awaiting_reply_since is null
      and greatest(d.last_inbound_at, d.last_outbound_at) <= t.due_at
      and s.kind <> 'agendado' and (d.scheduled_at is null or d.scheduled_at < ${now.toISOString()}::timestamptz)
      and c.kind = 'cliente' and not c.ignored and c.consent_whatsapp is not false and c.consent_ai is not false
      and not exists (select 1 from outbox o where o.deal_id = d.id and o.status in ('pending', 'sending'))
      and not exists (select 1 from outbox o where o.deal_id = d.id and o.options->>'taskId' = t.id::text)
    order by t.due_at desc limit ${vagas}`)).rows;
  let n2 = 0;
  for (const r of rows) {
    try {
      const s = await scheduleMessage({ dealId: r.deal_id, text: iaPlaceholder(r.title), ia: r.title, at: new Date(now.getTime() + AHEAD_MS) }, r.author, now);
      await db.update(outbox).set({ options: sql`${outbox.options} || ${JSON.stringify({ taskId: r.task_id, retomadaAuto: true })}::jsonb` }).where(eq(outbox.id, s.id));
      n2++;
    } catch (e) { console.error("[retomada automática]", r.deal_id, e instanceof Error ? e.message : e); }
  }
  return n2;
}
