import { sql } from "drizzle-orm";
import { rows } from "../common";
import type { DayRange } from "../salon";
import { listCaixaExceptions } from "../../queries/caixa-pagamentos";
import { DRAWER_METHODS, PAY_LABEL, type DrawerMethod } from "@/lib/comanda-math";

/**
 * Financeiro › Exceções (plano 4, auditoria da spec): descontos, cortesias, preços alterados, cancelamentos, reaberturas e sangrias, com
 * quem fez e o motivo. Saem dos dados (que sempre existem); quem e o motivo vêm do `audit_log` da mesma entidade quando há um com motivo
 * (o plano 3 grava), senão de quem lançou/fechou e "sem motivo". Do Avec: desconto e item a R$ 0 (sem ser sessão de pacote).
 */
export type ExceptionKind = "desconto_item" | "desconto_comanda" | "preco_alterado" | "cortesia" | "item_cancelado" | "comanda_cancelada" | "comanda_reaberta" | "sangria"
  | "estorno" | "contagem_recusada" | "caixa_diferenca" | "desconto_avec" | "zero_avec" | "profissional_trocada" | "assistente_alterado";
export const EXCEPTION_LABEL: Record<ExceptionKind, string> = {
  desconto_item: "Desconto no item", desconto_comanda: "Desconto na comanda", preco_alterado: "Preço alterado", cortesia: "Cortesia", item_cancelado: "Item cancelado",
  comanda_cancelada: "Comanda cancelada", comanda_reaberta: "Comanda reaberta para corrigir", sangria: "Sangria",
  estorno: "Estorno de pagamento", contagem_recusada: "Fechamento acima da tolerância", caixa_diferenca: "Diferença no fechamento", desconto_avec: "Desconto (Avec)", zero_avec: "Item a R$ 0 (Avec)",
  profissional_trocada: "Profissional diferente da agenda", assistente_alterado: "Assistente trocada",
};

/** Quantas de cada tipo, na ordem dos rótulos, só os tipos que aparecem (o resumo do Financeiro). */
export function exceptionCounts(list: FinanceException[]): { kind: ExceptionKind; label: string; count: number }[] {
  const n = new Map<ExceptionKind, number>();
  for (const x of list) n.set(x.kind, (n.get(x.kind) ?? 0) + 1);
  return (Object.keys(EXCEPTION_LABEL) as ExceptionKind[]).filter((k) => n.has(k)).map((k) => ({ kind: k, label: EXCEPTION_LABEL[k], count: n.get(k)! }));
}
export type FinanceException = {
  origin: "crm" | "avec"; kind: ExceptionKind; day: string; at: string | null; comanda: string | null; client: string | null; item: string | null;
  who: string | null; beforeCents: number | null; afterCents: number | null; valueCents: number | null; reason: string | null;
};

const NAME = (col: string) => sql.raw(`(select coalesce(initcap(lower(tn.signature)), tn.name) from users tn where tn.id = ${col})`);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

type Audit = { entityId: string; action: string; who: string | null; motivo: string | null; at: Date };
/**
 * O último registro com motivo de cada entidade, por tipo de ação (desconto, preço, cortesia). O caixa do plano 3 grava o do item na
 * comanda, com `data.itemId`: aí a entidade é o item (e o desconto do item não se confunde com o da comanda).
 */
async function audits(ids: string[]): Promise<Audit[]> {
  if (!ids.length) return [];
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `);
  return rows<Audit>(sql`
    select coalesce(nullif(al.data->>'itemId', ''), al.entity_id) as "entityId", al.action, ${NAME("al.user_id")} as who, al.data->>'motivo' as motivo, al.created_at as at
    from audit_log al where (al.entity_id in (${list}) or al.data->>'itemId' in (${list})) and al.data ? 'motivo' order by al.created_at desc`);
}
const pick = (list: Audit[], id: string, pattern: RegExp) => list.find((a) => a.entityId === id && pattern.test(a.action));

type ItemRow = {
  id: string; comandaId: string; day: string; number: number; client: string | null; closedAt: Date | null; label: string; kind: string; qty: number; unit: number | null;
  discount: number; ref: number | null; cancelledAt: Date | null; addedBy: string | null; cancelledBy: string | null;
};
type ComandaRow = { id: string; day: string; number: number; client: string | null; status: string; discount: number; total: number | null; closedAt: Date | null;
  cancelledAt: Date | null; reason: string | null; closedBy: string | null; cancelledBy: string | null; reopened: boolean };

type ClosedCash = { id: string; day: string; at: Date; expected: Record<string, number> | null; counted: Record<string, number> | null; notes: string | null;
  owner: string | null; closer: string | null; approver: string | null };
type Refusal = { day: string; at: Date; who: string | null; owner: string | null; data: Record<string, unknown> | null };

/** Contado − esperado por forma, só as que têm diferença, na ordem do fechamento. */
function formsOf(byMethod: Record<string, unknown> | null | undefined): { method: DrawerMethod; cents: number }[] {
  if (!byMethod) return [];
  return DRAWER_METHODS.map((m) => ({ method: m, cents: typeof byMethod[m] === "number" ? (byMethod[m] as number) : 0 })).filter((d) => d.cents !== 0);
}

/**
 * Fechamentos de caixa (QA r58, I-4): um caixa fechado vira uma linha por forma com diferença (a falta no dinheiro e a sobra no Pix são
 * duas linhas), com quem aprovou e a observação do fechamento como motivo. A tentativa recusada (acima da tolerância, sem aprovação) só
 * aparece enquanto o caixa segue aberto, e só a última: as recontagens não se repetem, e o fechamento aprovado já conta a história.
 */
async function cashClosings(r: DayRange): Promise<FinanceException[]> {
  const inDay = (col: string) => sql`(${sql.raw(col)} at time zone 'America/Bahia')::date between ${r.from}::date and ${r.to}::date`;
  const [closed, refused] = await Promise.all([
    rows<ClosedCash>(sql`
      select cs.id, to_char((cs.closed_at at time zone 'America/Bahia')::date, 'YYYY-MM-DD') as day, cs.closed_at as at, cs.expected, cs.counted,
        -- O motivo é a observação do FECHAMENTO (auditoria), nunca a da abertura que fica em cash_sessions.notes.
        (select al.data->>'motivo' from audit_log al where al.action = 'caixa_fechado' and al.entity_id = cs.id::text order by al.created_at desc limit 1) as notes,
        ${NAME("cs.opened_by")} as owner, ${NAME("cs.closed_by")} as closer, ${NAME("cs.approved_by")} as approver
      from cash_sessions cs where cs.status = 'fechado' and ${inDay("cs.closed_at")} order by cs.closed_at`),
    rows<Refusal>(sql`
      select distinct on (al.entity_id) to_char((al.created_at at time zone 'America/Bahia')::date, 'YYYY-MM-DD') as day, al.created_at as at,
        ${NAME("al.user_id")} as who, ${NAME("cs.opened_by")} as owner, al.data
      from audit_log al join cash_sessions cs on cs.id::text = al.entity_id
      where al.action = 'caixa_contagem_recusada' and cs.status = 'aberto' and ${inDay("al.created_at")}
        and (cs.reopened_at is null or al.created_at > cs.reopened_at) -- reaberto: as recusas de antes do fechamento aprovado já contaram
      order by al.entity_id, al.created_at desc`),
  ]);
  const out: FinanceException[] = [];
  const base = { origin: "crm" as const, comanda: null, beforeCents: null, afterCents: null };
  for (const c of closed) {
    const diffs = formsOf(Object.fromEntries(DRAWER_METHODS.map((m) => [m, (c.counted?.[m] ?? 0) - (c.expected?.[m] ?? 0)])));
    for (const d of diffs) out.push({ ...base, kind: "caixa_diferenca", day: c.day, at: iso(c.at), client: `Caixa de ${c.owner ?? "—"}`,
      item: `${PAY_LABEL[d.method]}${c.approver ? ` · aprovada por ${c.approver}` : ""}`, who: c.closer, valueCents: d.cents, reason: c.notes?.trim() || null });
  }
  for (const x of refused) {
    const d = x.data ?? {};
    const reason = typeof d.motivo === "string" && d.motivo.trim() ? d.motivo.trim() : null;
    const forms = formsOf(d.diferencas as Record<string, unknown> | undefined);
    const lines = forms.length ? forms.map((f) => ({ item: PAY_LABEL[f.method] as string | null, cents: f.cents as number | null }))
      : [{ item: null, cents: typeof d.diferenca === "number" ? d.diferenca : null }]; // registro antigo, só com o total
    for (const l of lines) out.push({ ...base, kind: "contagem_recusada", day: x.day, at: iso(x.at), client: forms.length ? `Caixa de ${x.owner ?? "—"}` : null,
      item: l.item, who: x.who, valueCents: l.cents, reason });
  }
  return out;
}

export async function financeExceptions(r: DayRange): Promise<FinanceException[]> {
  const inDay = sql`between ${r.from}::date and ${r.to}::date`;
  const [items, coms, courtesy, sangrias, avec, caixa, closings, trocas, assist] = await Promise.all([
    rows<ItemRow>(sql`
      select ci.id, c.id as "comandaId", c.day::text as day, c.number, c.client_name as client, c.closed_at as "closedAt", ci.label, ci.kind, ci.qty::float8 as qty,
        ci.unit_cents as unit, ci.discount_cents as discount, coalesce(a.price_cents, l.price_cents) as ref, ci.cancelled_at as "cancelledAt",
        ${NAME("ci.added_by")} as "addedBy", ${NAME("ci.cancelled_by")} as "cancelledBy"
      from comanda_items ci join comandas c on c.id = ci.comanda_id left join appointments a on a.id = ci.appointment_id left join lists l on l.id = ci.service_id
      where (c.status = 'fechada' or (c.status = 'aberta' and ci.cancelled_at is not null)) and c.day ${inDay}
        and (ci.cancelled_at is not null or ci.discount_cents > 0
          or (ci.kind = 'servico' and ci.unit_cents is not null and coalesce(a.price_cents, l.price_cents) is not null and ci.unit_cents <> coalesce(a.price_cents, l.price_cents)))`),
    rows<ComandaRow>(sql`
      select c.id, c.day::text as day, c.number, c.client_name as client, c.status, c.discount_cents as discount, c.total_cents as total, c.closed_at as "closedAt",
        c.cancelled_at as "cancelledAt", c.cancel_reason as reason, ${NAME("c.closed_by")} as "closedBy", ${NAME("c.cancelled_by")} as "cancelledBy",
        exists (select 1 from audit_log al where al.action = 'comanda_reaberta_para_corrigir' and al.data->>'de' = c.id::text) as reopened
      from comandas c where c.day ${inDay} and ((c.status = 'fechada' and c.discount_cents > 0) or c.status = 'cancelada')`),
    rows<{ id: string; comandaId: string; day: string; number: number; client: string | null; value: number; at: Date; who: string | null }>(sql`
      select cp.id, c.id as "comandaId", c.day::text as day, c.number, c.client_name as client, cp.value_cents as value, cp.created_at as at, ${NAME("cp.created_by")} as who
      from comanda_payments cp join comandas c on c.id = cp.comanda_id
      where c.status = 'fechada' and c.day ${inDay} and cp.cancelled_at is null and cp.method = 'cortesia'`),
    rows<{ id: string; day: string; value: number; reason: string; at: Date; who: string | null }>(sql`
      select m.id, (m.created_at at time zone 'America/Bahia')::date::text as day, m.value_cents as value, m.reason, m.created_at as at, ${NAME("m.created_by")} as who
      from cash_movements m where m.kind = 'sangria' and m.cancelled_at is null and (m.created_at at time zone 'America/Bahia')::date ${inDay}`),
    rows<{ day: string; comanda: string | null; client: string | null; item: string; value: number | null; discount: number | null; total: number }>(sql`
      select si.sold_on::text as day, si.comanda, si.client_name as client, si.item, si.value_cents as value, si.discount_cents as discount,
        coalesce(si.total_cents, si.value_cents - coalesce(si.discount_cents, 0), 0) as total
      from sales_items si where si.sold_on ${inDay} and (si.discount_cents > 0 or (not si.from_package and coalesce(si.total_cents, si.value_cents - coalesce(si.discount_cents, 0), 0) = 0))`),
    // Do caixa por pessoa (plano 3), só o que não sai dos dados acima: estorno, comanda reaberta no lugar e fechamento acima da tolerância.
    listCaixaExceptions(r),
    cashClosings(r),
    // Profissional do horário diferente da do item na comanda fechada (as duas preenchidas; item cancelado não conta).
    rows<{ day: string; number: number; client: string | null; label: string; closedAt: Date | null; agenda: string; comanda: string; who: string | null }>(sql`
      select c.day::text as day, c.number, c.client_name as client, ci.label, c.closed_at as "closedAt", pa.name as agenda, pc.name as comanda, ${NAME("c.closed_by")} as who
      from comanda_items ci join comandas c on c.id = ci.comanda_id join appointments a on a.id = ci.appointment_id
        join professionals pa on pa.id = a.professional_id join professionals pc on pc.id = ci.professional_id
      where c.status = 'fechada' and c.day ${inDay} and ci.cancelled_at is null and a.professional_id <> ci.professional_id`),
    // Assistente trocada: o audit da Tarefa 4 (nomes antes e depois), no dia do registro.
    rows<{ at: Date; day: string; number: string | null; client: string | null; item: string | null; de: string[] | null; para: string[] | null; who: string | null }>(sql`
      select al.created_at as at, to_char((al.created_at at time zone 'America/Bahia')::date, 'YYYY-MM-DD') as day, al.data->>'numero' as number, c.client_name as client,
        al.data->>'item' as item, al.data->'de' as de, al.data->'para' as para, ${NAME("al.user_id")} as who
      from audit_log al left join comandas c on c.id::text = al.entity_id
      where al.action = 'assistente_alterado' and (al.created_at at time zone 'America/Bahia')::date ${inDay}`),
  ]);
  const au = await audits([...items.map((i) => i.id), ...coms.map((c) => c.id), ...courtesy.flatMap((p) => [p.id, p.comandaId])]);
  const out: FinanceException[] = [];
  const base = (day: string, number: number, client: string | null) => ({ origin: "crm" as const, day, comanda: String(number), client });

  for (const i of items) {
    const gross = i.unit == null ? null : Math.round(i.qty * i.unit);
    if (i.cancelledAt) {
      const a = pick(au, i.id, /cancel/);
      out.push({ ...base(i.day, i.number, i.client), kind: "item_cancelado", at: iso(i.cancelledAt), item: i.label, who: i.cancelledBy ?? a?.who ?? null, beforeCents: null, afterCents: null, valueCents: gross, reason: a?.motivo ?? null });
      continue;
    }
    if (i.discount > 0) {
      const a = pick(au, i.id, /desconto/);
      out.push({ ...base(i.day, i.number, i.client), kind: "desconto_item", at: iso(a?.at ?? i.closedAt), item: i.label, who: a?.who ?? i.addedBy,
        beforeCents: gross, afterCents: gross == null ? null : Math.max(0, gross - i.discount), valueCents: i.discount, reason: a?.motivo ?? null });
    }
    if (i.kind === "servico" && i.unit != null && i.ref != null && i.unit !== i.ref) {
      const a = pick(au, i.id, /preco|preço/);
      out.push({ ...base(i.day, i.number, i.client), kind: "preco_alterado", at: iso(a?.at ?? i.closedAt), item: i.label, who: a?.who ?? i.addedBy,
        beforeCents: i.ref, afterCents: i.unit, valueCents: i.unit - i.ref, reason: a?.motivo ?? null });
    }
  }
  for (const c of coms) {
    if (c.status === "cancelada") {
      out.push({ ...base(c.day, c.number, c.client), kind: c.reopened ? "comanda_reaberta" : "comanda_cancelada", at: iso(c.cancelledAt), item: null, who: c.cancelledBy,
        beforeCents: null, afterCents: null, valueCents: c.total, reason: c.reason?.trim() || null });
    } else {
      const a = pick(au, c.id, /desconto/);
      out.push({ ...base(c.day, c.number, c.client), kind: "desconto_comanda", at: iso(a?.at ?? c.closedAt), item: null, who: a?.who ?? c.closedBy,
        beforeCents: null, afterCents: null, valueCents: c.discount, reason: a?.motivo ?? null });
    }
  }
  for (const p of courtesy) {
    const a = pick(au, p.id, /cortesia/) ?? pick(au, p.comandaId, /cortesia/);
    out.push({ ...base(p.day, p.number, p.client), kind: "cortesia", at: iso(a?.at ?? p.at), item: null, who: a?.who ?? p.who, beforeCents: null, afterCents: null, valueCents: p.value, reason: a?.motivo ?? null });
  }
  for (const m of sangrias) out.push({ origin: "crm", kind: "sangria", day: m.day, at: iso(m.at), comanda: null, client: null, item: null, who: m.who, beforeCents: null, afterCents: null, valueCents: m.value, reason: m.reason });
  const DAY = (at: string) => new Date(Date.parse(at) - 3 * 3_600_000).toISOString().slice(0, 10); // Salvador, sem horário de verão
  for (const x of caixa) {
    // A contagem recusada sai dos fechamentos (cashClosings), uma vez por forma.
    if (x.kind !== "estorno" && x.kind !== "comanda_reaberta") continue;
    out.push({ origin: "crm", kind: x.kind, day: DAY(x.at), at: x.at, comanda: x.comandaNumber == null ? null : String(x.comandaNumber), client: null, item: x.item,
      who: x.userName, beforeCents: null, afterCents: null, valueCents: x.valueCents, reason: x.reason });
  }
  out.push(...closings);
  for (const t of trocas) {
    out.push({ ...base(t.day, t.number, t.client), kind: "profissional_trocada", at: iso(t.closedAt), item: t.label, who: t.who, beforeCents: null, afterCents: null, valueCents: null, reason: `Agenda: ${t.agenda} · Comanda: ${t.comanda}` });
  }
  for (const x of assist) {
    const names = (v: string[] | null) => (v && v.length ? v.join(", ") : "ninguém");
    out.push({ origin: "crm", kind: "assistente_alterado", day: x.day, at: iso(x.at), comanda: x.number, client: x.client, item: x.item, who: x.who, beforeCents: null, afterCents: null, valueCents: null,
      reason: `De ${names(x.de)} para ${names(x.para)}` });
  }
  for (const x of avec) {
    const zero = Number(x.total) === 0 && !(x.discount && x.discount > 0);
    out.push({ origin: "avec", kind: zero ? "zero_avec" : "desconto_avec", day: x.day, at: null, comanda: x.comanda, client: x.client, item: x.item, who: null,
      beforeCents: x.value, afterCents: Number(x.total), valueCents: zero ? x.value : x.discount, reason: null });
  }
  return out.sort((a, b) => b.day.localeCompare(a.day) || (b.at ?? "").localeCompare(a.at ?? ""));
}
