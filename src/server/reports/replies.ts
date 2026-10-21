import { sql, type SQL } from "drizzle-orm";
import { dealScope, iso, pct, periodWindow, rows, SLA_FALLBACK_SECONDS, upTo, type ReportFilter, type Window } from "./common";

/**
 * A mensagem que respondeu cada evento `resposta` (alias `rm`): a do próprio evento (`payload.messageId`, gravado desde o Lote 3) ou a do
 * `mensagem_enviada` gravado na MESMA transação (mesmo `created_at`; eventos antigos). Dela sai a autora (Lote 1A: assinatura do
 * celular/ChatGuru ou quem estava logada no CRM), também nas mensagens acertadas para trás pelo script do 1A.
 */
export const REPLY_MESSAGE_JOIN = (ev = "e"): SQL => sql.raw(`
  left join lateral (select me.payload->>'messageId' as mid from deal_events me
    where me.deal_id = ${ev}.deal_id and me.type = 'mensagem_enviada' and me.created_at = ${ev}.created_at limit 1) pm on true
  left join messages rm on rm.id = coalesce(${ev}.payload->>'messageId', pm.mid)::uuid`);

/**
 * Todas as respostas do período (não só a primeira), pela hora da mensagem. `author_id` null = sem autora (áudio, foto, celular sem
 * assinatura). Vale para qualquer conversa: quem respondeu não precisa ser a dona.
 */
export const repliesWithAuthor = (f: ReportFilter, w: Window): SQL => sql`
  select (e.payload->>'waitedSeconds')::int as w, coalesce((e.payload->>'slaSeconds')::int, ${SLA_FALLBACK_SECONDS}) as sla, rm.sent_by_user_id as author_id
  from deal_events e join deals d on d.id = e.deal_id ${REPLY_MESSAGE_JOIN()}
  where e.type = 'resposta' and e.created_at >= ${iso(w.from)}::timestamptz - interval '7 days'
    and coalesce(rm.created_at, e.created_at) >= ${iso(w.from)}::timestamptz and ${upTo("coalesce(rm.created_at, e.created_at)", w)}
    and ${dealScope({ ...f, ownerId: null })}`;

export type AuthorReplyRow = { userId: string; name: string; n: number; p50: number | null; slaHit: number; slaHitPct: number | null };
export type AuthorReplies = { rows: AuthorReplyRow[]; semAutora: number };

/**
 * "Tempo de resposta por atendente": cada pessoa que respondeu no período, com a mediana (expediente) e quantas no prazo.
 * Com `f.ownerId` (atendente sem "toda a equipe", ver `scopedFilter`), só a linha dela e sem o "sem autora".
 */
export async function replyTimesByAuthor(f: ReportFilter): Promise<AuthorReplies> {
  const w = periodWindow(f);
  const r = await rows<{ userId: string | null; name: string | null; n: number; p50: number | null; hit: number }>(sql`
    with rr as (${repliesWithAuthor(f, w)})
    select rr.author_id as "userId", u.name, count(*)::int as n, round(percentile_cont(0.5) within group (order by rr.w))::int as p50,
      count(*) filter (where rr.w <= rr.sla)::int as hit
    from rr left join users u on u.id = rr.author_id group by rr.author_id, u.name`);
  const own = f.ownerId ?? null;
  return {
    rows: r.filter((x): x is typeof x & { userId: string } => !!x.userId && (!own || x.userId === own))
      .map((x) => ({ userId: x.userId, name: x.name ?? "Sem nome", n: x.n, p50: x.p50, slaHit: x.hit, slaHitPct: pct(x.hit, x.n) }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    semAutora: own ? 0 : r.find((x) => !x.userId)?.n ?? 0,
  };
}
