import { sql } from "drizzle-orm";
import { NON_OPENING_KINDS } from "../domain/message-kinds";
import { cohort, dealScope, iso, MIN_SAMPLE, NOT_IDENTIFIED, pct, periodWindow, previousWindow, rows, SLA_FALLBACK_SECONDS, SOURCE_EXPR, upTo, WON_SQL, type ReportFilter, type Window } from "./common";
import { REPLY_MESSAGE_JOIN } from "./replies";

/** Venda (antiga Fechado ou Atendida que terminou) e conversa em andamento, nas consultas com `s` = stages e `d` = deals. */
const WON = sql.raw(WON_SQL);
const OPEN = sql.raw(`(s.kind <> 'perdido' and not ${WON_SQL})`);

const num = (n: number | string | null | undefined) => Number(n ?? 0);

// ------------------------------------------------------------------------------------------------
// R4: primeira resposta
// ------------------------------------------------------------------------------------------------
/**
 * Primeiras respostas humanas dos leads da coorte: 1 por lead, `waitedSeconds` já em segundos de expediente.
 * Só vale a resposta que já tinha acontecido até o fim da janela (no período anterior, até o corte).
 * Prazo (`sla`): o da etapa no momento da resposta; etapa sem prazo usa a reserva do Lead (ou 2 min).
 * Quem respondeu (`user_id`): a AUTORA da mensagem (Lote 1A: assinatura ou pessoa logada); sem autora, quem o evento guardou (a dona).
 */
export const firstResponses = (f: ReportFilter, w: Window) => sql`
  select (e.payload->>'waitedSeconds')::int as w, coalesce(rm.sent_by_user_id, e.user_id) as user_id,
    coalesce((e.payload->>'slaSeconds')::int, ${SLA_FALLBACK_SECONDS}) as sla,
    e.payload->>'stage' as stage, (e.payload->>'fromPhone' = 'true') as from_phone
  from deals d
  join lateral (select ev.payload, ev.user_id, ev.deal_id, ev.created_at from deal_events ev
    where ev.deal_id = d.id and ev.type = 'resposta' and ev.payload->>'first' = 'true' order by ev.created_at limit 1) e on true
  ${REPLY_MESSAGE_JOIN()}
  where d.first_response_at is not null and ${upTo("d.first_response_at", w)} and ${cohort(f, w)}`;

/**
 * Estado dos leads da coorte no fim da janela: `c` (primeira resposta e fechado/perdido só valem se já tinham acontecido; senão o lead
 * ainda estava em aberto) e `reached` (etapas que o lead já tinha alcançado, pela etapa atual e pelas mudanças de etapa até o corte).
 */
const cohortStates = (f: ReportFilter, w: Window) => sql`
  c as (
    select d.id, d.value_cents, d.stage_id, d.stage_entered_at, ${SOURCE_EXPR()} as origem,
      case when d.first_response_at is not null and ${upTo("d.first_response_at", w)} then d.first_response_at end as first_response_at,
      case when d.closed_at is not null and not (${upTo("d.closed_at", w)}) then 'aberto' when ${WON} then 'fechado' else s.kind::text end as kind
    from deals d join stages s on s.id = d.stage_id where ${cohort(f, w)}
  ),
  reached as (
    select c.id, s.kind::text as kind from c join stages s on s.id = c.stage_id where ${upTo("c.stage_entered_at", w)}
    union select c.id, s2.kind::text from c join deal_events e on e.deal_id = c.id and e.type = 'etapa_alterada' and ${upTo("e.created_at", w)}
      join stages s2 on s2.key = e.payload->>'para'
  )`;
/** Chegou a Agendado ou além: fechar direto também passa pelo marco (o funil é monotônico). */
const REACHED_AGENDADO = sql`exists (select 1 from reached r where r.id = c.id and r.kind in ('agendado', 'atendido', 'fechado'))`;

export type Bands = { ate2: number; de2a10: number; de10a60: number; mais1h: number };
export type FirstResponseStats = {
  n: number; p50: number | null; p90: number | null; bands: Bands; slaHitPct: number | null;
  /** Quantas das n respostas saíram dentro do prazo (o numerador de `slaHitPct`). */
  slaHit: number;
  /** Leads da coorte, ainda abertos no corte, em que a cliente escreveu e ninguém respondeu (lead iniciado pela Casa, sem mensagem da cliente, não entra). */
  semResposta: number;
  byStage: { stage: string; name: string; n: number; p50: number | null; slaSeconds: number | null; slaHitPct: number | null }[];
};

async function firstResponseStats(f: ReportFilter, w: Window): Promise<FirstResponseStats> {
  const [agg] = await rows<{ n: number; p50: number | null; p90: number | null; ate2: number; de2a10: number; de10a60: number; mais1h: number; hit: number }>(sql`
    with fr as (${firstResponses(f, w)})
    select count(*)::int as n, round(percentile_cont(0.5) within group (order by w))::int as p50, round(percentile_cont(0.9) within group (order by w))::int as p90,
      count(*) filter (where w <= 120)::int as ate2, count(*) filter (where w > 120 and w <= 600)::int as de2a10,
      count(*) filter (where w > 600 and w <= 3600)::int as de10a60, count(*) filter (where w > 3600)::int as mais1h,
      count(*) filter (where w <= sla)::int as hit
    from fr`);
  const byStage = await rows<{ stage: string; name: string | null; n: number; p50: number | null; sla: number | null; hit: number }>(sql`
    with fr as (${firstResponses(f, w)})
    select fr.stage, s.name, count(*)::int as n, round(percentile_cont(0.5) within group (order by fr.w))::int as p50,
      max(fr.sla)::int as sla, count(*) filter (where fr.w <= fr.sla)::int as hit
    from fr left join stages s on s.key = fr.stage where fr.stage is not null group by fr.stage, s.name, s.position order by s.position nulls last`);
  const [pending] = await rows<{ n: number }>(sql`
    with ${cohortStates(f, w)}
    select count(*)::int as n from c where c.kind not in ('fechado', 'perdido') and c.first_response_at is null
      and exists (select 1 from messages m where m.deal_id = c.id and m.direction = 'in' and m.kind not in (${sql.join(NON_OPENING_KINDS.map((k) => sql`${k}`), sql`, `)}) and ${upTo("m.created_at", w)})`);
  return {
    n: agg.n, p50: agg.p50, p90: agg.p90, bands: { ate2: agg.ate2, de2a10: agg.de2a10, de10a60: agg.de10a60, mais1h: agg.mais1h },
    slaHitPct: pct(agg.hit, agg.n), slaHit: agg.hit, semResposta: pending?.n ?? 0,
    byStage: byStage.map((s) => ({ stage: s.stage, name: s.name ?? s.stage, n: s.n, p50: s.p50, slaSeconds: s.sla, slaHitPct: pct(s.hit, s.n) })),
  };
}

export async function firstResponse(f: ReportFilter): Promise<FirstResponseStats & { previous?: FirstResponseStats }> {
  const w = periodWindow(f);
  const [cur, prev] = await Promise.all([firstResponseStats(f, w), f.compare ? firstResponseStats(f, previousWindow(w)) : null]);
  return prev ? { ...cur, previous: prev } : cur;
}

// ------------------------------------------------------------------------------------------------
// R5: funil por marcos (coorte)
// ------------------------------------------------------------------------------------------------
export type Milestones = {
  leads: number; respondidos: number; agendados: number; fechados: number; perdidos: number; emAberto: number;
  /** % das conversas novas que chegaram a cada marco (sempre de 0 a 100, pois a base é a mesma coorte). null sem leads. */
  conv: { respondido: number | null; agendado: number | null; fechado: number | null };
};

// "Respondido" = a Casa respondeu (ou o lead já passou de Em conversa). Estar em Em conversa não basta: a cliente que volta nasce lá (Tarefa 3.10).
async function milestones(f: ReportFilter, w: Window): Promise<Milestones> {
  const [r] = await rows<{ leads: number; respondidos: number; agendados: number; fechados: number; perdidos: number; abertos: number }>(sql`
    with ${cohortStates(f, w)}
    select count(*)::int as leads,
      count(*) filter (where c.first_response_at is not null or exists (select 1 from reached r where r.id = c.id and r.kind in ('agendado', 'followup', 'proposta', 'atendido', 'retorno', 'fechado')))::int as respondidos,
      count(*) filter (where ${REACHED_AGENDADO})::int as agendados,
      count(*) filter (where c.kind = 'fechado')::int as fechados, count(*) filter (where c.kind = 'perdido')::int as perdidos,
      count(*) filter (where c.kind not in ('fechado', 'perdido'))::int as abertos
    from c`);
  return {
    leads: r.leads, respondidos: r.respondidos, agendados: r.agendados, fechados: r.fechados, perdidos: r.perdidos, emAberto: r.abertos,
    conv: { respondido: pct(r.respondidos, r.leads), agendado: pct(r.agendados, r.leads), fechado: pct(r.fechados, r.leads) },
  };
}

export async function funnelMilestones(f: ReportFilter): Promise<Milestones & { previous?: Milestones }> {
  const w = periodWindow(f);
  const [cur, prev] = await Promise.all([milestones(f, w), f.compare ? milestones(f, previousWindow(w)) : null]);
  return prev ? { ...cur, previous: prev } : cur;
}

// ------------------------------------------------------------------------------------------------
// R6: parados agora
// ------------------------------------------------------------------------------------------------
export type StaleRow = { stageKey: string; stage: string; total: number; parados: number; maisAntigoSeg: number | null };

/** Conversas abertas por etapa e quantos estão parados além do limite de dias da etapa (mesma regra do motor). */
export async function staleNow(opts: { now?: Date; ownerId?: string | null; source?: string | null } = {}): Promise<StaleRow[]> {
  const now = iso(opts.now ?? new Date());
  // Conversa arquivada (atendimento terminado) não conta como parada, como na Fila.
  const stale = sql`s.stale_days is not null and d.conversation_archived_at is null and d.stage_entered_at <= ${now}::timestamptz - make_interval(days => s.stale_days)`;
  const r = await rows<{ stageKey: string; stage: string; total: number; parados: number; mais: number | null }>(sql`
    select s.key as "stageKey", s.name as stage, count(d.id)::int as total, count(d.id) filter (where ${stale})::int as parados,
      floor(max(extract(epoch from (${now}::timestamptz - d.stage_entered_at))) filter (where ${stale}))::int as mais
    from stages s left join deals d on d.stage_id = s.id and d.closed_at is null and ${dealScope({ period: "hoje", ownerId: opts.ownerId, source: opts.source })}
    where s.active and s.kind not in ('fechado', 'perdido') group by s.id order by s.position`);
  return r.map((x) => ({ stageKey: x.stageKey, stage: x.stage, total: x.total, parados: x.parados, maisAntigoSeg: x.mais }));
}

// ------------------------------------------------------------------------------------------------
// R8: origem até a venda (coorte)
// ------------------------------------------------------------------------------------------------
export type SourceRow = { origem: string; leads: number; agendados: number; fechados: number; receitaCents: number };

export async function sourceToSale(f: ReportFilter): Promise<SourceRow[]> {
  const w = periodWindow(f);
  const r = await rows<SourceRow>(sql`
    with ${cohortStates(f, w)}
    select c.origem, count(*)::int as leads, count(*) filter (where ${REACHED_AGENDADO})::int as agendados,
      count(*) filter (where c.kind = 'fechado')::int as fechados, coalesce(sum(c.value_cents) filter (where c.kind = 'fechado'), 0)::float8 as "receitaCents"
    from c group by c.origem order by leads desc, c.origem`);
  const out = r.map((x) => ({ ...x, receitaCents: num(x.receitaCents) }));
  if (!out.some((x) => x.origem === NOT_IDENTIFIED)) out.push({ origem: NOT_IDENTIFIED, leads: 0, agendados: 0, fechados: 0, receitaCents: 0 });
  return out;
}

// ------------------------------------------------------------------------------------------------
// R9: perdas e objeções
// ------------------------------------------------------------------------------------------------
export type Losses = {
  total: number;
  byReason: { motivo: string; n: number }[];
  byStage: { stage: string; n: number }[];
  matrix: { motivo: string; stage: string; n: number }[];
  objections: { objection: string; n: number; fechados: number; perdidos: number; emAberto: number }[];
};

/** Perdas ocorridas no período (por data de perda), por motivo e por etapa de onde saíram; objeções dos leads da coorte por resultado. */
export async function lossesByReasonAndStage(f: ReportFilter): Promise<Losses> {
  const w = periodWindow(f);
  const [matrix, objections] = await Promise.all([
    rows<{ motivo: string; stage: string; n: number }>(sql`
      with lost as (
        select case when d.lost_reason_detail is not null then coalesce(l.label, 'Outro') || ': ' || d.lost_reason_detail else coalesce(l.label, 'Sem motivo informado') end as motivo,
          (select e.payload->>'de' from deal_events e where e.deal_id = d.id and e.type = 'etapa_alterada' and e.payload->>'para' = s.key order by e.created_at desc limit 1) as de
        from deals d join stages s on s.id = d.stage_id left join lists l on l.id = d.lost_reason_id
        where s.kind = 'perdido' and d.closed_at >= ${iso(w.from)}::timestamptz and ${upTo("d.closed_at", w)} and ${dealScope(f)}
      )
      select lost.motivo, coalesce(st.name, lost.de, 'Não registrada') as stage, count(*)::int as n
      from lost left join stages st on st.key = lost.de group by 1, 2 order by n desc, 1, 2`),
    rows<{ objection: string; n: number; fechados: number; perdidos: number; emAberto: number }>(sql`
      select l.label as objection, count(*)::int as n, count(*) filter (where ${WON})::int as fechados,
        count(*) filter (where s.kind = 'perdido')::int as perdidos, count(*) filter (where ${OPEN})::int as "emAberto"
      from deals d join lists l on l.id = d.objection_id join stages s on s.id = d.stage_id where ${cohort(f, w)}
      group by l.label order by n desc, l.label`),
  ]);
  const sum = (key: "motivo" | "stage") => {
    const m = new Map<string, number>();
    for (const r of matrix) m.set(r[key], (m.get(r[key]) ?? 0) + r.n);
    return [...m].map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k, "pt-BR"));
  };
  return {
    total: matrix.reduce((a, r) => a + r.n, 0),
    byReason: sum("motivo").map(({ k, n }) => ({ motivo: k, n })),
    byStage: sum("stage").map(({ k, n }) => ({ stage: k, n })),
    matrix, objections,
  };
}

// ------------------------------------------------------------------------------------------------
// R13: financeiro
// ------------------------------------------------------------------------------------------------
/** Quanto já foi pago: o valor pago informado; se só há data de pagamento, a venda inteira. */
const PAID = sql`(case when d.paid_cents is not null then d.paid_cents when d.paid_at is not null then coalesce(d.value_cents, 0) else 0 end)`;
export const REMAINING = sql`greatest(coalesce(d.value_cents, 0) - ${PAID}, 0)`;

export type ChargeItem = { id: string; contactId: string; name: string | null; phone: string; chargeAt: string; remainingCents: number };
export type FinanceWithPaid = {
  vendas: number; /** Vendas que têm valor informado (o denominador do ticket). */ vendasComValor: number;
  totalCents: number; pagoCents: number; aReceberCents: number; ticketCents: number | null;
  byMethod: { method: string | null; n: number; totalCents: number; pagoCents: number }[];
  vencidas: { n: number; cents: number; items: ChargeItem[] };
  aVencer: { n: number; cents: number; items: ChargeItem[] };
};

export async function financeWithPaid(f: ReportFilter): Promise<FinanceWithPaid> {
  const w = periodWindow(f);
  const now = iso(w.to), from = iso(w.from);
  const charges = (overdue: boolean) => rows<ChargeItem>(sql`
    select d.id, d.contact_id as "contactId", c.name, c.phone_e164 as phone, d.charge_at as "chargeAt", ${REMAINING}::float8 as "remainingCents"
    from deals d join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id
    where ${WON} and d.charge_at is not null and ${overdue ? sql`d.charge_at < ${now}::timestamptz` : sql`d.charge_at >= ${now}::timestamptz`}
      and ${REMAINING} > 0 and ${dealScope(f)} order by d.charge_at ${overdue ? sql`desc` : sql`asc`} limit 30`);
  const [byMethod, [agg], over, up] = await Promise.all([
    rows<{ method: string | null; n: number; comValor: number; total: number; pago: number; receber: number }>(sql`
      select d.payment_method as method, count(*)::int as n, count(d.value_cents)::int as "comValor", coalesce(sum(d.value_cents), 0)::float8 as total,
        coalesce(sum(${PAID}), 0)::float8 as pago, coalesce(sum(${REMAINING}), 0)::float8 as receber
      from deals d join stages s on s.id = d.stage_id
      where ${WON} and d.closed_at >= ${from}::timestamptz and d.closed_at <= ${now}::timestamptz and ${dealScope(f)}
      group by d.payment_method order by total desc`),
    rows<{ overdueN: number; overdueC: number; upN: number; upC: number }>(sql`
      select count(*) filter (where d.charge_at < ${now}::timestamptz)::int as "overdueN",
        coalesce(sum(${REMAINING}) filter (where d.charge_at < ${now}::timestamptz), 0)::float8 as "overdueC",
        count(*) filter (where d.charge_at >= ${now}::timestamptz)::int as "upN",
        coalesce(sum(${REMAINING}) filter (where d.charge_at >= ${now}::timestamptz), 0)::float8 as "upC"
      from deals d join stages s on s.id = d.stage_id
      where ${WON} and d.charge_at is not null and ${REMAINING} > 0 and ${dealScope(f)}`),
    charges(true), charges(false),
  ]);
  const vendas = byMethod.reduce((a, b) => a + b.n, 0);
  const vendasComValor = byMethod.reduce((a, b) => a + b.comValor, 0);
  const totalCents = byMethod.reduce((a, b) => a + num(b.total), 0);
  const fix = (i: ChargeItem[]) => i.map((x) => ({ ...x, remainingCents: num(x.remainingCents) }));
  return {
    vendas, vendasComValor, totalCents, pagoCents: byMethod.reduce((a, b) => a + num(b.pago), 0), aReceberCents: byMethod.reduce((a, b) => a + num(b.receber), 0),
    ticketCents: vendasComValor ? Math.round(totalCents / vendasComValor) : null,
    byMethod: byMethod.map((m) => ({ method: m.method, n: m.n, totalCents: num(m.total), pagoCents: num(m.pago) })),
    vencidas: { n: agg?.overdueN ?? 0, cents: num(agg?.overdueC), items: fix(over) },
    aVencer: { n: agg?.upN ?? 0, cents: num(agg?.upC), items: fix(up) },
  };
}

// ------------------------------------------------------------------------------------------------
// R15: qualidade dos dados
// ------------------------------------------------------------------------------------------------
export type QualityCheck = { key: string; label: string; n: number; of: number };

/**
 * O que falta nas conversas ativas de agora (não depende do período): cada item diz quantos de quantos.
 * Respeita a pessoa e a origem escolhidas; a atendente só enxerga os leads dela (quem chama passa `ownerId`).
 */
export async function dataQuality(f: Pick<ReportFilter, "ownerId" | "source" | "origin"> = {}): Promise<{ checks: QualityCheck[]; overallPct: number | null }> {
  const [r] = await rows<Record<string, number>>(sql`
    select count(*)::int as total,
      count(*) filter (where ${WON})::int as fechados,
      count(*) filter (where ${WON} and d.value_cents is null)::int as "fechadosSemValor",
      count(*) filter (where ${WON} and d.service_id is null)::int as "fechadosSemServico",
      count(*) filter (where ${WON} and d.payment_method is null)::int as "fechadosSemPagamento",
      count(*) filter (where s.kind = 'perdido')::int as perdidos,
      count(*) filter (where s.kind = 'perdido' and d.lost_reason_id is null)::int as "perdidosSemMotivo",
      count(*) filter (where ${OPEN})::int as abertos,
      count(*) filter (where ${OPEN} and d.owner_id is null)::int as "abertosSemResponsavel",
      count(*) filter (where s.kind = 'agendado')::int as agendados,
      count(*) filter (where s.kind = 'agendado' and d.scheduled_at is null)::int as "agendadosSemData",
      count(*) filter (where ${SOURCE_EXPR()} = ${NOT_IDENTIFIED})::int as "semOrigem"
    from deals d join stages s on s.id = d.stage_id where ${dealScope({ period: "hoje", ownerId: f.ownerId, source: f.source, origin: f.origin })}`);
  const checks: QualityCheck[] = [
    { key: "fechadosSemValor", label: "Vendas sem valor", n: r.fechadosSemValor, of: r.fechados },
    { key: "fechadosSemServico", label: "Vendas sem serviço", n: r.fechadosSemServico, of: r.fechados },
    { key: "fechadosSemPagamento", label: "Vendas sem forma de pagamento", n: r.fechadosSemPagamento, of: r.fechados },
    { key: "perdidosSemMotivo", label: "Perdidos sem motivo", n: r.perdidosSemMotivo, of: r.perdidos },
    { key: "abertosSemResponsavel", label: "Conversas em aberto sem responsável", n: r.abertosSemResponsavel, of: r.abertos },
    { key: "agendadosSemData", label: "Agendados sem data", n: r.agendadosSemData, of: r.agendados },
    { key: "semOrigem", label: "Conversas sem origem identificada", n: r.semOrigem, of: r.total },
  ];
  const bad = checks.reduce((a, c) => a + c.n, 0), all = checks.reduce((a, c) => a + c.of, 0);
  return { checks, overallPct: all ? Math.round(100 * (1 - bad / all)) : null };
}

// ------------------------------------------------------------------------------------------------
// R16: CRM x celular
// ------------------------------------------------------------------------------------------------
/** De quem foi a primeira resposta dos leads da coorte: pelo CRM ou direto pelo celular. */
export async function crmVsPhone(f: ReportFilter): Promise<{ crm: number; celular: number; total: number; crmPct: number | null }> {
  const w = periodWindow(f);
  const [r] = await rows<{ crm: number; celular: number }>(sql`
    with fr as (${firstResponses(f, w)})
    select count(*) filter (where not from_phone)::int as crm, count(*) filter (where from_phone)::int as celular from fr`);
  return { crm: r.crm, celular: r.celular, total: r.crm + r.celular, crmPct: pct(r.crm, r.crm + r.celular) };
}

// ------------------------------------------------------------------------------------------------
// R10: eficácia de follow-up
// ------------------------------------------------------------------------------------------------
export type FollowupRow = { kind: string; previstas: number; concluidas: number; canceladas: number; noPrazo: number; comResposta: number; fechados: number; respostaPct: number | null };

/**
 * Tarefas com prazo no período (e já vencidas), por tipo. Cancelada (evento `tarefa` com acao = cancelada) não é concluída nem prevista:
 * vem à parte em `canceladas`. Das concluídas: no prazo (até o horário combinado), com resposta da cliente em até 72 h depois, e lead fechado depois.
 */
export async function followupEfficacy(f: ReportFilter): Promise<FollowupRow[]> {
  const w = periodWindow(f);
  const r = await rows<Omit<FollowupRow, "respostaPct">>(sql`
    select t.kind, count(*) filter (where not x.cancelada)::int as previstas, count(*) filter (where x.cancelada)::int as canceladas,
      count(t.done_at) filter (where not x.cancelada)::int as concluidas,
      count(*) filter (where not x.cancelada and t.done_at <= t.due_at)::int as "noPrazo",
      count(*) filter (where not x.cancelada and t.done_at is not null and exists (select 1 from messages m where m.deal_id = t.deal_id and m.direction = 'in'
        and m.created_at > t.done_at and m.created_at <= t.done_at + interval '72 hours'))::int as "comResposta",
      count(*) filter (where not x.cancelada and t.done_at is not null and ${WON} and d.closed_at >= t.done_at)::int as fechados
    from tasks t join deals d on d.id = t.deal_id join stages s on s.id = d.stage_id
    cross join lateral (select exists (select 1 from deal_events ce where ce.deal_id = t.deal_id and ce.type = 'tarefa'
      and ce.payload->>'acao' = 'cancelada' and ce.payload->>'tarefa' = t.id::text) as cancelada) x
    where t.due_at >= ${iso(w.from)}::timestamptz and ${upTo("t.due_at", w)} and ${dealScope(f)}
    group by t.kind order by t.kind`);
  return r.map((x) => ({ ...x, respostaPct: pct(x.comResposta, x.concluidas) }));
}

// ------------------------------------------------------------------------------------------------
// R11: mapa de calor
// ------------------------------------------------------------------------------------------------
/** Mensagens recebidas por dia da semana (0 = domingo … 6 = sábado) e hora (0–23), no fuso de Salvador. */
export async function demandHeatmap(f: ReportFilter): Promise<number[][]> {
  const w = periodWindow(f);
  const r = await rows<{ dow: number; h: number; n: number }>(sql`
    select extract(dow from m.created_at at time zone 'America/Bahia')::int as dow, extract(hour from m.created_at at time zone 'America/Bahia')::int as h, count(*)::int as n
    from messages m join deals d on d.id = m.deal_id
    where m.direction = 'in' and m.created_at >= ${iso(w.from)}::timestamptz and ${upTo("m.created_at", w)} and ${dealScope(f)}
    group by 1, 2`);
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const x of r) grid[x.dow][x.h] = x.n;
  return grid;
}

// ------------------------------------------------------------------------------------------------
// R7: pessoa contra a meta
// ------------------------------------------------------------------------------------------------
export type PersonStats = { n: number; p50: number | null; slaHitPct: number | null };
export type PersonRow = PersonStats & { userId: string; name: string; goalSeconds: number; previous: PersonStats | null };

async function personStats(f: ReportFilter, w: Window) {
  return rows<{ userId: string; name: string; n: number; p50: number | null; hit: number; sla: number }>(sql`
    with fr as (${firstResponses(f, w)})
    select fr.user_id as "userId", u.name, count(*)::int as n, round(percentile_cont(0.5) within group (order by fr.w))::int as p50,
      count(*) filter (where fr.w <= fr.sla)::int as hit, (${SLA_FALLBACK_SECONDS})::int as sla
    from fr join users u on u.id = fr.user_id group by fr.user_id, u.name`);
}

/**
 * Cada atendente contra a meta e contra o próprio período anterior. Só com n >= 20; ordem alfabética; sem ranking.
 * A resposta dada pelo celular vale para quem está com a conversa (quem assumiu). `goalSeconds` é a meta da etapa Lead de agora (ou 2 min);
 * o % no prazo usa o prazo da etapa de cada resposta.
 */
export async function personVsGoal(f: ReportFilter): Promise<PersonRow[]> {
  const w = periodWindow(f);
  const [cur, prev] = await Promise.all([personStats(f, w), personStats(f, previousWindow(w))]);
  const before = new Map(prev.map((p) => [p.userId, p]));
  return cur.filter((p) => p.n >= MIN_SAMPLE)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((p) => {
      const b = before.get(p.userId);
      return {
        userId: p.userId, name: p.name, n: p.n, p50: p.p50, slaHitPct: pct(p.hit, p.n), goalSeconds: p.sla,
        previous: b && b.n >= MIN_SAMPLE ? { n: b.n, p50: b.p50, slaHitPct: pct(b.hit, b.n) } : null,
      };
    });
}

// ------------------------------------------------------------------------------------------------
// R2: os 5 números
// ------------------------------------------------------------------------------------------------
export async function salesAgg(f: ReportFilter, w: Window) {
  const [r] = await rows<{ n: number; withValue: number; cents: number }>(sql`
    select count(*)::int as n, count(d.value_cents)::int as "withValue", coalesce(sum(d.value_cents), 0)::float8 as cents
    from deals d join stages s on s.id = d.stage_id
    where ${WON} and d.closed_at >= ${iso(w.from)}::timestamptz and ${upTo("d.closed_at", w)} and ${dealScope(f)}`);
  return { n: r.n, withValue: r.withValue, cents: num(r.cents) };
}

export type Metric = { atual: number | null; anterior: number | null; n: number; nAnterior: number };
export type ExecutiveNumbers = {
  leadsNovos: Metric; pctPrimeiraRespostaNoSla: Metric; agendamentosMarcados: Metric;
  vendas: { atual: { n: number; cents: number }; anterior: { n: number; cents: number } };
  ticketMedio: Metric;
};

/** Os 5 números do topo, cada um com o período atual e o anterior de mesmo tamanho (hoje x ontem até a mesma hora) e o n por trás. */
export async function executiveNumbers(f: ReportFilter): Promise<ExecutiveNumbers> {
  const w = periodWindow(f), pw = previousWindow(w), cw: Window = { from: w.from, to: w.to };
  const [fr, frP, mi, miP, sa, saP] = await Promise.all([
    firstResponseStats(f, cw), firstResponseStats(f, pw), milestones(f, cw), milestones(f, pw), salesAgg(f, cw), salesAgg(f, pw),
  ]);
  // Ticket: soma dos valores dividida só pelas vendas que têm valor (venda sem valor não puxa a média para baixo).
  const ticket = (s: { withValue: number; cents: number }) => (s.withValue ? Math.round(s.cents / s.withValue) : null);
  const money = (s: { n: number; cents: number }) => ({ n: s.n, cents: s.cents });
  return {
    leadsNovos: { atual: mi.leads, anterior: miP.leads, n: mi.leads, nAnterior: miP.leads },
    pctPrimeiraRespostaNoSla: { atual: fr.slaHitPct, anterior: frP.slaHitPct, n: fr.n, nAnterior: frP.n },
    agendamentosMarcados: { atual: mi.agendados, anterior: miP.agendados, n: mi.leads, nAnterior: miP.leads },
    vendas: { atual: money(sa), anterior: money(saP) },
    ticketMedio: { atual: ticket(sa), anterior: ticket(saP), n: sa.withValue, nAnterior: saP.withValue },
  };
}

// ------------------------------------------------------------------------------------------------
// Filtro de origem da tela
// ------------------------------------------------------------------------------------------------
/** Origens reais que existem nas conversas ativas (da pessoa, se `ownerId`), para o seletor da tela ("Não identificada" sempre presente, por último). */
export async function reportSources(ownerId?: string | null): Promise<string[]> {
  const r = await rows<{ s: string }>(sql`select distinct ${SOURCE_EXPR()} as s from deals d where ${dealScope({ period: "hoje", ownerId })}`);
  const out = r.map((x) => x.s).filter((x) => x !== NOT_IDENTIFIED).sort((a, b) => a.localeCompare(b, "pt-BR"));
  return [...out, NOT_IDENTIFIED];
}
