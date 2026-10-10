import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { excerptAround } from "../../lib/highlight";

/** Mensagens varridas por busca (as mais recentes que casam): o limite mantém a busca rápida mesmo com o histórico inteiro importado. */
export const MESSAGE_HIT_LIMIT = 500;
/** A busca de trecho de mensagem só começa com 3 letras (o índice trigram não ajuda com menos) e o nome parecido, com 4. */
const MESSAGE_MIN = 3, FUZZY_MIN = 4;

/** Texto do usuário vira padrão de ILIKE: `%`, `_` e `\` valem como texto. */
const likeOf = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

export type ContactRow = {
  id: string; name: string | null; phone: string; email: string | null; instagram: string | null;
  isClient: boolean; clientSince: string | null; lastServiceAt: string | null; ignored: boolean; hasAvatar: boolean;
  /** O lead mais recente (qualquer estado) e o lead em andamento, se houver, com quem cuida dele. */
  lastDealId: string | null; openDealId: string | null; openDealOwnerId: string | null; openDealOwnerName: string | null; deals: number;
  /** A mensagem em que o termo apareceu (recortada em volta do acerto), quando a busca achou por ela. */
  snippet: { text: string; at: string } | null;
};

/**
 * A lista de Contatos e a busca. Com termo: nome (também parecido, `pg_trgm`), e-mail, telefone (só os dígitos) e trecho de mensagem
 * (`ILIKE` com o índice `messages_body_trgm`, limitado às `MESSAGE_HIT_LIMIT` mais recentes), do mais parecido ao menos.
 * Contato "Não é cliente" fica de fora, a não ser que `includeIgnored`.
 */
export async function listContacts(opts: { q?: string | null; onlyClients?: boolean; includeIgnored?: boolean; page?: number }) {
  const size = 50; const page = Math.max(1, opts.page ?? 1);
  const term = opts.q?.trim().slice(0, 80) ?? "";
  const like = likeOf(term);
  const digits = term.replace(/\D/g, "");
  const byMessage = term.length >= MESSAGE_MIN;
  // Telefone só quando o termo se parece com telefone: "100%" tem dígitos, mas não é número.
  const byPhone = digits.length >= 3 && /^[\d\s()+.-]+$/.test(term) ? sql`c.phone_e164 like ${`%${digits}%`}` : sql`false`;
  const byName = sql`(coalesce(c.name, '') ilike ${like}${term.length >= FUZZY_MIN ? sql` or c.name % ${term}` : sql``})`;

  const conds: SQL[] = [sql`true`];
  if (!opts.includeIgnored) conds.push(sql`not c.ignored`);
  if (opts.onlyClients) conds.push(sql`c.is_client`);
  if (term) conds.push(sql`(${byName} or coalesce(c.email, '') ilike ${like} or ${byPhone}${byMessage ? sql` or h.contact_id is not null` : sql``})`);
  const where = sql.join(conds, sql` and `);

  // Uma mensagem por contato (a mais recente que casa). Só existe quando há termo com tamanho para isso.
  const hits = term && byMessage
    ? sql`hits as (
        select distinct on (contact_id) contact_id, body, created_at from (
          select contact_id, body, created_at from messages where body ilike ${like} and deleted_at is null order by created_at desc limit ${MESSAGE_HIT_LIMIT}
        ) m order by contact_id, created_at desc)`
    : sql`hits as (select null::uuid as contact_id, null::text as body, null::timestamptz as created_at where false)`;
  const order = term
    ? sql`greatest(similarity(coalesce(c.name, ''), ${term}), case when coalesce(c.name, '') ilike ${like} then 0.7 else 0 end, case when ${byPhone} then 0.9 else 0 end, case when h.contact_id is not null then 0.2 else 0 end) desc, c.created_at desc, c.id`
    : sql`c.created_at desc, c.id`;

  const rows = await db.execute(sql`
    with ${hits}
    select c.id, c.name, c.phone_e164 as phone, c.email, c.instagram, c.is_client as "isClient", c.client_since as "clientSince", c.last_service_at as "lastServiceAt",
      c.ignored, (c.avatar_path is not null) as "hasAvatar", h.body as "hitBody", h.created_at as "hitAt",
      (select d.id from deals d where d.contact_id = c.id order by d.created_at desc limit 1) as "lastDealId",
      od.id as "openDealId", od.owner_id as "openDealOwnerId", ou.name as "openDealOwnerName",
      (select count(*)::int from deals d where d.contact_id = c.id) as deals
    from contacts c
    left join hits h on h.contact_id = c.id
    left join lateral (select d.id, d.owner_id from deals d join stages s on s.id = d.stage_id
      where d.contact_id = c.id and d.archived_at is null and s.kind not in ('fechado', 'perdido') order by d.created_at desc limit 1) od on true
    left join users ou on ou.id = od.owner_id
    where ${where}
    order by ${order} limit ${size} offset ${(page - 1) * size}`);
  const [{ total }] = (await db.execute(sql`
    with ${hits}
    select count(*)::int as total from contacts c left join hits h on h.contact_id = c.id where ${where}`)).rows as { total: number }[];

  type Raw = Omit<ContactRow, "snippet"> & { hitBody: string | null; hitAt: string | null };
  return {
    rows: (rows.rows as Raw[]).map(({ hitBody, hitAt, ...r }): ContactRow => ({
      ...r, snippet: hitBody && hitAt ? { text: excerptAround(hitBody, term), at: new Date(hitAt).toISOString() } : null,
    })),
    total, page, size,
  };
}
