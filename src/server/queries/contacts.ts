import { phoneSearchVariants } from "@/lib/phone-search";
import { cpfSearchDigits } from "@/lib/cpf";
import { sql, type SQL } from "drizzle-orm";
import { activePurchaseSql } from "./package-purchase-sql";
import { db, type Tx } from "../db";
import { excerptAround } from "../../lib/highlight";
import { lateExists } from "./late-count";
import { clientSituation, type SituationState } from "../../lib/client-situation";
import { BIRTHDAY_WEEK_DAYS, FALTOSA_MIN, FUTURE_HORIZON_DAYS, GONE_MAX_DAYS, RETURN_GONE, RETURN_SOON, VIP_MIN_VISITS, VIP_TOP_SHARE } from "../../lib/client-rhythm";
import { birthdayLabel } from "../../lib/birthday";
import { CONTACT_FILTERS, type ContactFilter, type ContactListParams, type ContactSort, type ContactTab } from "../../lib/contact-list-params";
import { isUuid } from "../../lib/uuid";

/** Mensagens varridas por busca (as mais recentes que casam): o limite mantém a busca rápida mesmo com o histórico inteiro importado. */
export const MESSAGE_HIT_LIMIT = 500;
/** A busca de trecho de mensagem só começa com 3 letras (o índice trigram não ajuda com menos) e o nome parecido, com 4. */
const MESSAGE_MIN = 3, FUZZY_MIN = 4;
const TZ = "America/Bahia";

/** Texto do usuário vira padrão de ILIKE: `%`, `_` e `\` valem como texto. */
const likeOf = (term: string) => `%${term.replace(/[\\%_]/g, "\\$&")}%`;

export type ContactRow = {
  id: string; name: string | null; phone: string; email: string | null; instagram: string | null;
  isClient: boolean; clientSince: string | null; lastServiceAt: string | null; ignored: boolean; hasAvatar: boolean;
  /** O lead mais recente (qualquer estado) e o lead em andamento, se houver, com quem cuida dele. */
  lastDealId: string | null; openDealId: string | null; openDealOwnerId: string | null; openDealOwnerName: string | null; deals: number;
  /** A mensagem em que o termo apareceu (recortada em volta do acerto), quando a busca achou por ela. */
  snippet: { text: string; at: string } | null;
  /** Lote 2: colunas da lista (da visão por contato e ao vivo). */
  visits: number; lastVisitOn: string | null; nextAppointmentAt: string | null; nextProfessional: string | null;
  preferredProfessional: string | null; pkg: { used: number; total: number } | null; birthday: string | null; origin: string | null;
  /** A frase curta e os estados (a mesma regra da ficha). */
  situation: string; states: SituationState[];
};

export type ContactListOpts = Partial<ContactListParams> & { now?: Date; ids?: string[]; pageSize?: number };

const dayOf = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const isoOf = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

/**
 * Cliente do Método Fiaes: no histórico (Avec ou CRM) algum serviço, pacote, sessão ou horário com "Método Fiaes" no nome (com ou sem acento,
 * maiúsculas ou não), ou a etiqueta manual "Método Fiaes". O resto das clientes é "Serviços gerais".
 */
const METODO_RE = "m[eéÉ]todo[[:space:]]*fiaes";
const metodoSql = sql`exists (
    select 1 from sales_items mi where mi.contact_id = c.id and mi.item ~* ${METODO_RE}
    union all select 1 from appointments ma where ma.contact_id = c.id and ma.service_label ~* ${METODO_RE}
    union all select 1 from client_packages mp where mp.contact_id = c.id and (mp.package_name ~* ${METODO_RE} or coalesce(mp.service_label, '') ~* ${METODO_RE})
    union all select 1 from package_uses mu where mu.contact_id = c.id and mu.item ~* ${METODO_RE}
    union all select 1 from deals md join lists ml on ml.id = md.service_id where md.contact_id = c.id and ml.label ~* ${METODO_RE}
    union all select 1 from contact_tags mct join tags mt on mt.id = mct.tag_id where mct.contact_id = c.id and mt.name ~* ${METODO_RE})`;
const tabSql = (tab: ContactTab): SQL => (tab === "metodo" ? metodoSql : sql`(c.is_client and not ${metodoSql})`);

/** Busca e filtros em lista: o "onde" comum à lista, à contagem dos botões e ao CSV. */
function base(opts: ContactListOpts) {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const today = sql`((${at}::timestamptz at time zone ${TZ})::date)`;
  const term = opts.q?.trim().slice(0, 80) ?? "";
  const like = likeOf(term);
  const digits = term.replace(/\D/g, "");
  const byMessage = term.length >= MESSAGE_MIN;
  // Telefone só quando o termo se parece com telefone: "100%" tem dígitos, mas não é número.
  // Com ou sem +55, DDD, máscara e o 9 da frente ("90000004", "71 99000-0004"): ver `phoneSearchVariants`.
  const phoneVs = digits.length >= 3 && /^[\d\s()+.-]+$/.test(term) ? phoneSearchVariants(term) : [];
  // Pessoa a mais num número (filha, mãe…, 0051): acha pelo telefone do titular.
  const byPhone = phoneVs.length
    ? sql`(${sql.join(phoneVs.map((v) => sql`c.phone_e164 like ${`%${v}%`} or exists (select 1 from contacts hp where hp.id = c.shares_phone_with and hp.phone_e164 like ${`%${v}%`})`), sql` or `)})`
    : sql`false`;
  const byName = sql`(coalesce(c.name, '') ilike ${like}${term.length >= FUZZY_MIN ? sql` or c.name % ${term}` : sql``})`;

  const conds: SQL[] = [sql`true`];
  if (!opts.includeIgnored) conds.push(sql`not c.ignored`);
  if (opts.onlyClients) conds.push(sql`c.is_client`);
  const cpfQ = cpfSearchDigits(term);
  const byCpf = cpfQ ? sql` or c.cpf like ${`%${cpfQ}%`}` : sql``;
  if (term) conds.push(sql`(${byName} or coalesce(c.email, '') ilike ${like} or ${byPhone}${byCpf}${byMessage ? sql` or h.contact_id is not null` : sql``})`);
  // Um parâmetro só, no formato de array do Postgres ({a,b}): o drizzle espalharia um array JS em ($1, $2, …).
  if (opts.ids?.length) conds.push(sql`c.id = any(${`{${opts.ids.filter(isUuid).join(",")}}`}::uuid[])`);
  if (opts.professionalId && isUuid(opts.professionalId)) conds.push(sql`coalesce(c.preferred_professional_id, s.preferred_professional_id) = ${opts.professionalId}`);
  if (opts.service) conds.push(sql`exists (select 1 from sales_items si where si.contact_id = c.id and si.kind = 'servico' and lower(trim(si.item)) = lower(${opts.service}))`);
  if (opts.tagId && isUuid(opts.tagId)) conds.push(sql`exists (select 1 from contact_tags ct where ct.contact_id = c.id and ct.tag_id = ${opts.tagId})`);
  if (opts.origin) conds.push(sql`s.origin_label = ${opts.origin}`);
  if (opts.tab) conds.push(tabSql(opts.tab));

  // Uma mensagem por contato (a mais recente que casa). Os filtros do contato valem ANTES do limite (um ignorado cheio de mensagens não gasta as vagas).
  const hitConds: SQL[] = [sql`m.body ilike ${like}`, sql`m.deleted_at is null`];
  if (!opts.includeIgnored) hitConds.push(sql`not hc.ignored`);
  if (opts.onlyClients) hitConds.push(sql`hc.is_client`);
  const hits = term && byMessage
    ? sql`hits as (
        select distinct on (contact_id) contact_id, body, created_at from (
          select m.contact_id, m.body, m.created_at from messages m join contacts hc on hc.id = m.contact_id
          where ${sql.join(hitConds, sql` and `)} order by m.created_at desc limit ${MESSAGE_HIT_LIMIT}
        ) m order by contact_id, created_at desc)`
    : sql`hits as (select null::uuid as contact_id, null::text as body, null::timestamptz as created_at where false)`;

  // Uma linha por contato, com a visão (s), o próximo horário até 180 dias (fut), a conversa aberta (od) e o pacote ativo (pk).
  const from = sql`
    from contacts c
    left join contact_stats s on s.contact_id = c.id
    left join hits h on h.contact_id = c.id
    left join lateral (
      select a.starts_at, p.name as pro_name from appointments a left join professionals p on p.id = a.professional_id
       where a.contact_id = c.id and a.status in ('agendado', 'confirmado') and a.starts_at > ${at}::timestamptz
         and a.starts_at <= ${at}::timestamptz + ${FUTURE_HORIZON_DAYS} * interval '1 day'
       order by a.starts_at limit 1) fut on true
    left join lateral (
      select d.id, d.owner_id, d.awaiting_reply_since, d.stage_entered_at, d.conversation_archived_at, st.name as stage_name, st.kind::text as stage_kind,
             ${lateExists(sql`d.id`)} as late
        from deals d join stages st on st.id = d.stage_id
       where d.contact_id = c.id and d.archived_at is null and d.closed_at is null and st.kind not in ('fechado', 'perdido')
       order by d.created_at desc limit 1) od on true
    left join users ou on ou.id = od.owner_id
    left join lateral ${activePurchaseSql(sql`c.id`, today)} pk on true`;

  const vipCut = sql`(select percentile_disc(${1 - VIP_TOP_SHARE}::float8) within group (order by total_cents) from contact_stats where total_cents > 0)`;
  const order = term
    ? sql`greatest(similarity(coalesce(c.name, ''), ${term}), case when coalesce(c.name, '') ilike ${like} then 0.7 else 0 end, case when ${byPhone} then 0.9 else 0 end, case when h.contact_id is not null then 0.2 else 0 end) desc, c.created_at desc, c.id`
    : sql`c.created_at desc, c.id`;
  return { now, today, term, where: sql.join(conds, sql` and `), hits, from, vipCut, order };
}

/** O que cada botão de filtro quer dizer, em SQL (as mesmas comparações de `returnInfo`, em src/lib/client-rhythm.ts). */
function filterSql(f: ContactFilter, today: SQL, vipCut: SQL): SQL {
  const every = sql`coalesce(s.rhythm_days, s.cycle_days)`;
  const since = sql`(${today} - s.last_visit_on)`;
  switch (f) {
    case "na_hora": return sql`(fut.starts_at is null and ${every} is not null and ${since} >= ${RETURN_SOON}::numeric * ${every} and ${since} <= ${RETURN_GONE}::numeric * ${every})`;
    case "sumidas": return sql`(fut.starts_at is null and ${every} is not null and ${since} > ${RETURN_GONE}::numeric * ${every} and ${since} < ${GONE_MAX_DAYS})`;
    case "aniversario_semana": return sql`exists (select 1 from generate_series(0, ${BIRTHDAY_WEEK_DAYS}) g
      where extract(month from (${today} + g))::int = c.birth_month and (extract(day from (${today} + g))::int = c.birth_day
        or (c.birth_month = 2 and c.birth_day = 29 and extract(day from (${today} + g))::int = 28
            and extract(day from (date_trunc('year', (${today} + g)) + interval '1 month 28 days'))::int <> 29)))`;
    case "aniversario_mes": return sql`(c.birth_month = extract(month from ${today})::int)`;
    case "com_pacote": return sql`(pk.total_sessions is not null)`;
    case "com_horario": return sql`(fut.starts_at is not null)`;
    case "sem_dono": return sql`(od.id is not null and od.owner_id is null and od.conversation_archived_at is null)`;
    case "nunca_voltou": return sql`(s.visits = 1)`;
    case "vip": return sql`(s.visits >= ${VIP_MIN_VISITS} or (s.total_cents > 0 and s.total_cents >= ${vipCut}))`;
    case "faltosas": return sql`(s.no_shows >= ${FALTOSA_MIN})`;
  }
}

const SORT: Record<ContactSort, SQL> = {
  chegada: sql`c.created_at desc, c.id`,
  ultima_visita: sql`s.last_visit_on desc nulls last, c.created_at desc, c.id`,
  visitas: sql`coalesce(s.visits, 0) desc, s.last_visit_on desc nulls last, c.id`,
  nome: sql`c.name is null, lower(c.name), c.id`,
};

/**
 * A lista de Contatos e a busca. Com termo: nome (também parecido, `pg_trgm`), e-mail, telefone (só os dígitos) e trecho de mensagem.
 * Filtros (Lote 2): um botão (`filter`) e os filtros em lista (profissional, serviço, etiqueta, origem). Ordem: a pedida; sem pedido,
 * por parecido (com busca) ou por chegada (sem busca), como antes. "Não é cliente" fica de fora, a não ser que `includeIgnored`.
 */
export async function listContacts(opts: ContactListOpts) {
  const size = Math.min(5000, Math.max(1, opts.pageSize ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const b = base(opts);
  const where = opts.filter ? sql`${b.where} and ${filterSql(opts.filter, b.today, b.vipCut)}` : b.where;
  const order = opts.sort ? SORT[opts.sort] : b.order;
  const rows = (await db.execute(sql`
    with ${b.hits}
    select c.id, c.name, coalesce((select hp.phone_e164 from contacts hp where hp.id = c.shares_phone_with), c.phone_e164) as phone, c.email, c.instagram, c.is_client as "isClient", c.client_since as "clientSince", c.last_service_at as "lastServiceAt",
      c.ignored, (c.avatar_path is not null) as "hasAvatar", c.birth_day as "birthDay", c.birth_month as "birthMonth", h.body as "hitBody", h.created_at as "hitAt",
      (select d.id from deals d where d.contact_id = c.id order by d.created_at desc limit 1) as "lastDealId",
      od.id as "openDealId", od.owner_id as "openDealOwnerId", ou.name as "openDealOwnerName",
      (select count(*)::int from deals d where d.contact_id = c.id) as deals,
      coalesce(s.visits, 0) as visits, s.last_visit_on as "lastVisitOn", s.rhythm_days as "rhythmDays", s.cycle_days as "cycleDays", s.origin_label as origin,
      fut.starts_at as "nextAt", fut.pro_name as "nextProfessional",
      coalesce(cp.name, s.preferred_professional_name) as "preferredProfessional",
      pk.used_sessions as "pkgUsed", pk.total_sessions as "pkgTotal",
      od.stage_name as "stageName", od.stage_kind as "stageKind", od.awaiting_reply_since as "awaitingSince", od.stage_entered_at as "stageEnteredAt",
      od.conversation_archived_at as "convArchivedAt", coalesce(od.late, false) as late
    ${b.from}
    left join professionals cp on cp.id = c.preferred_professional_id
    where ${where}
    order by ${order} limit ${size} offset ${(page - 1) * size}`)).rows as Record<string, unknown>[];
  const [{ total }] = (await db.execute(sql`with ${b.hits} select count(*)::int as total ${b.from} where ${where}`)).rows as { total: number }[];

  const nowMs = b.now.getTime();
  return {
    rows: rows.map((r): ContactRow => {
      const birthDay = r.birthDay as number | null, birthMonth = r.birthMonth as number | null;
      const nextAt = isoOf(r.nextAt);
      const conv = r.openDealId && !r.convArchivedAt ? {
        stageName: String(r.stageName), stageKind: String(r.stageKind), ownerName: (r.openDealOwnerName as string | null) ?? null,
        enteredAt: isoOf(r.stageEnteredAt)!, awaitingSince: isoOf(r.awaitingSince), late: !!r.late,
      } : null;
      const s = clientSituation({
        lastVisitOn: dayOf(r.lastVisitOn), rhythmDays: (r.rhythmDays as number | null) ?? null, cycleDays: (r.cycleDays as number | null) ?? null,
        nextAppointment: nextAt ? { startsAt: nextAt, professionalName: (r.nextProfessional as string | null) ?? null } : null,
        activePackage: r.pkgTotal != null ? { usedSessions: Number(r.pkgUsed), totalSessions: Number(r.pkgTotal) } : null,
        conversation: conv, birthday: birthDay && birthMonth ? { day: birthDay, month: birthMonth } : null,
      }, nowMs);
      return {
        id: String(r.id), name: (r.name as string | null) ?? null, phone: String(r.phone), email: (r.email as string | null) ?? null, instagram: (r.instagram as string | null) ?? null,
        isClient: !!r.isClient, clientSince: isoOf(r.clientSince), lastServiceAt: isoOf(r.lastServiceAt), ignored: !!r.ignored, hasAvatar: !!r.hasAvatar,
        lastDealId: (r.lastDealId as string | null) ?? null, openDealId: (r.openDealId as string | null) ?? null, openDealOwnerId: (r.openDealOwnerId as string | null) ?? null,
        openDealOwnerName: (r.openDealOwnerName as string | null) ?? null, deals: Number(r.deals),
        snippet: r.hitBody && r.hitAt ? { text: excerptAround(String(r.hitBody), b.term), at: isoOf(r.hitAt)! } : null,
        visits: Number(r.visits), lastVisitOn: dayOf(r.lastVisitOn), nextAppointmentAt: nextAt, nextProfessional: (r.nextProfessional as string | null) ?? null,
        preferredProfessional: (r.preferredProfessional as string | null) ?? null,
        pkg: r.pkgTotal != null ? { used: Number(r.pkgUsed), total: Number(r.pkgTotal) } : null,
        birthday: birthdayLabel(birthDay, birthMonth), origin: (r.origin as string | null) ?? null,
        situation: s.short, states: s.states,
      };
    }),
    total, page, size,
  };
}

/** A contagem de cada botão de filtro, com a busca e os filtros em lista aplicados (sem o próprio botão). `runner`: o ensaio passa a transação. */
export async function contactFilterCounts(opts: ContactListOpts, runner: Tx | typeof db = db): Promise<Record<ContactFilter, number>> {
  const b = base(opts);
  const cols = sql.join(CONTACT_FILTERS.map((f) => sql`count(*) filter (where ${filterSql(f, b.today, b.vipCut)})::int as ${sql.identifier(f)}`), sql`, `);
  const [row] = (await runner.execute(sql`with ${b.hits} select ${cols} ${b.from} where ${b.where}`)).rows as Record<ContactFilter, number>[];
  return row;
}

/** A contagem de cada aba (Todas · Método Fiaes · Serviços gerais), com a busca e os filtros aplicados (sem a própria aba). */
export async function contactTabCounts(opts: ContactListOpts): Promise<{ todas: number; metodo: number; gerais: number }> {
  const o = { ...opts, tab: null };
  const b = base(o);
  const where = o.filter ? sql`${b.where} and ${filterSql(o.filter, b.today, b.vipCut)}` : b.where;
  const [row] = (await db.execute(sql`with ${b.hits} select count(*)::int as todas, count(*) filter (where ${tabSql("metodo")})::int as metodo,
    count(*) filter (where ${tabSql("gerais")})::int as gerais ${b.from} where ${where}`)).rows as { todas: number; metodo: number; gerais: number }[];
  return row;
}

/** Opções dos filtros em lista: profissionais ativas, serviços já feitos (os 80 mais comuns), etiquetas e origens. */
export async function contactListOptions() {
  const [pros, services, tagRows, origins] = await Promise.all([
    db.execute(sql`select id, name from professionals where active order by name`),
    db.execute(sql`select trim(item) as item from sales_items where kind = 'servico' and nullif(trim(item), '') is not null group by trim(item) order by count(distinct contact_id) desc limit 80`),
    db.execute(sql`select id, name from tags order by lower(name)`),
    db.execute(sql`select origin_label from contact_stats where origin_label is not null group by origin_label order by count(*) desc limit 40`),
  ]);
  return {
    professionals: pros.rows as { id: string; name: string }[],
    services: (services.rows as { item: string }[]).map((r) => r.item).sort((a, b) => a.localeCompare(b, "pt-BR")),
    tags: tagRows.rows as { id: string; name: string }[],
    origins: (origins.rows as { origin_label: string }[]).map((r) => r.origin_label),
  };
}
