// src/server/queries/team-now.ts
import { sql } from "drizzle-orm";
import { db } from "../db";
import { teamState, type TeamState } from "../../lib/team-now";

export type TeamMemberNow = {
  id: string; name: string; state: TeamState; waiting: number; mine: number; lastReplyAt: string | null; lastReplyVia: "celular" | "crm" | null;
  /** O perfil tem "Receber leads da distribuição": só quem recebe aparece na linha da Fila (a gestão que não atende fica de fora). */
  receives: boolean;
};
export type TeamNow = { members: TeamMemberNow[]; unowned: { waiting: number; total: number } };

const REPLY_LOOKBACK_DAYS = 7;

/**
 * "Equipe agora" (Fila e Hoje): cada pessoa com o estado, quantas conversas esperam resposta dela, quantas são dela e a última resposta
 * (pelo CRM ou, pela assinatura, pelo celular). Fica de fora quem não tem conversa, não respondeu em 7 dias e não está com o CRM aberto.
 * As contagens são da equipe toda, não de quem vê: é o quadro da sala. Conversa encerrada, arquivada ou de contato ignorado não conta.
 * Quem não vê o Atendimento (a profissional, que só tem o app) não aparece.
 */
export async function getTeamNow(now = new Date()): Promise<TeamNow> {
  const since = new Date(now.getTime() - REPLY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const open = sql`d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null and c.kind = 'cliente'`;
  const [people, unowned] = await Promise.all([
    db.execute(sql`
      select u.id, coalesce(initcap(lower(u.signature)), u.name) as name, u.availability, u.last_seen_at,
        coalesce(p.permissions @> array['distribuicao.receber']::text[], false) as receives,
        (select count(*)::int from deals d join contacts c on c.id = d.contact_id where d.owner_id = u.id and ${open}) as mine,
        (select count(*)::int from deals d join contacts c on c.id = d.contact_id where d.owner_id = u.id and ${open} and d.awaiting_reply_since is not null) as waiting,
        lr.created_at as last_reply_at, lr.via as last_reply_via
      from users u
      left join profiles p on p.id = u.profile_id
      left join lateral (
        select m.created_at, coalesce(m.sent_via, case when m.from_phone then 'celular' else 'crm' end) as via
        from messages m
        where m.sent_by_user_id = u.id and m.direction = 'out' and m.created_at >= ${since}::timestamptz and m.created_at <= ${now.toISOString()}::timestamptz
        order by m.created_at desc limit 1) lr on true
      where u.active and u.password_hash is not null
        and (p.id is null or p.permissions @> array['atendimento.ver']::text[])
      order by waiting desc, u.name`),
    db.execute(sql`
      select count(*)::int as total, (count(*) filter (where d.awaiting_reply_since is not null))::int as waiting
      from deals d join contacts c on c.id = d.contact_id where d.owner_id is null and ${open}`),
  ]);
  type Row = { id: string; name: string; availability: string; receives: boolean; last_seen_at: Date | string | null; mine: number; waiting: number; last_reply_at: Date | string | null; last_reply_via: "celular" | "crm" | null };
  const members = (people.rows as Row[]).map((r): TeamMemberNow => ({
    id: r.id, name: r.name, mine: r.mine, waiting: r.waiting, receives: r.receives,
    state: teamState({ availability: r.availability, lastSeenAt: r.last_seen_at, lastReplyAt: r.last_reply_at }, now),
    lastReplyAt: r.last_reply_at ? new Date(r.last_reply_at).toISOString() : null, lastReplyVia: r.last_reply_at ? r.last_reply_via : null,
  })).filter((m) => m.mine > 0 || m.lastReplyAt !== null || m.state !== "sem_sinal");
  const u = unowned.rows[0] as { total: number; waiting: number };
  return { members, unowned: { waiting: u.waiting, total: u.total } };
}
