import { sql } from "drizzle-orm";
import { db } from "../db";
import { bahiaAt } from "@/lib/next-action";
import { dayProgressText } from "@/lib/day-progress";

/**
 * Progresso do dia (pesquisa 20/10, Amabile: progresso visível motiva). Da Casa toda, sem nome de ninguém: nada de ranking.
 * - `answered`: conversas que esperavam a Casa e foram respondidas hoje (ou resolvidas sem precisar de resposta) e não voltaram a esperar;
 * - `total`: essas mais as que esperam agora (de hoje ou de antes);
 * - `oldestSince`: desde quando espera a mais antiga (número neutro, "a mais antiga espera há 14 min").
 * Fica de fora o que a Fila também não conta: arquivada, Não é cliente/Spam/Fornecedor/Equipe, atendimento encerrado.
 */
export type DayProgress = { answered: number; total: number; waiting: number; oldestSince: Date | null };

export async function getDayProgress(now = new Date()): Promise<DayProgress> {
  const dayStart = bahiaAt(now.getTime(), 0, 0).toISOString();
  const live = sql`d.archived_at is null and d.closed_at is null and c.kind = 'cliente'`;
  const r = await db.execute(sql`
    with handled as (
      select distinct e.deal_id from deal_events e join deals d on d.id = e.deal_id join contacts c on c.id = d.contact_id
      where e.type in ('resposta', 'resolvida') and e.created_at >= ${dayStart}::timestamptz and ${live}
    ), waiting as (
      select d.id, d.awaiting_reply_since from deals d join contacts c on c.id = d.contact_id
      where d.awaiting_reply_since is not null and d.conversation_archived_at is null and ${live}
    )
    select (select count(*)::int from handled h where h.deal_id not in (select id from waiting)) as answered,
      (select count(*)::int from waiting) as waiting,
      (select min(awaiting_reply_since) from waiting) as oldest`);
  const row = r.rows[0] as { answered: number; waiting: number; oldest: string | Date | null };
  return { answered: row.answered, waiting: row.waiting, total: row.answered + row.waiting, oldestSince: row.oldest ? new Date(row.oldest) : null };
}

/** A linha pronta do topo da Fila (o texto sai do servidor: o "há 14 min" é o da hora em que a Fila foi montada). */
export async function getDayProgressLine(now = new Date()): Promise<{ text: string; done: boolean } | null> {
  return dayProgressText(await getDayProgress(now), now.getTime());
}
