import { sql } from "drizzle-orm";
import { db } from "../db";
import { ACTIVE_STATUSES, statusGroup } from "@/lib/appointment-status";
import { dayOf, todayBahia } from "@/lib/agenda";
import { rows } from "../reports/common";
import { normText } from "../domain/avec/normalize";
import { cashSummary, getOpenCashTx, notEmptySql, type CashSummary } from "../domain/caixa/cash";
import { getCaixaRules } from "../domain/caixa/mode";
import { isBlindFor } from "@/lib/caixa-settings";
import { getCaixaMode } from "../domain/caixa/mode";
import { can } from "@/lib/permissions";
import { listTeamCash, type TeamCashRow } from "./caixa";

/**
 * Caixa › Fechar o dia (plano 4): o que falta para encerrar o dia. Passo 1, horários de hoje que já acabaram e seguem sem desfecho, com o
 * que o Avec diz; passo 2, comandas abertas; passo 3, o caixa aberto (a interface de hoje: um caixa da Casa; o plano 3 troca por pessoa).
 */
export type AvecHint = { status: "compareceu" | "faltou" | "cancelado" | "aberto"; why: "status" | "comanda" };
export type NoOutcomeRow = {
  id: string; startsAt: string; endsAt: string; clientName: string; contactId: string | null; professional: string | null; service: string;
  status: string; avec: AvecHint | null; suggest: "compareceu" | "faltou" | null;
};
/** Sem duração cadastrada, o horário conta como de 60 min. */
export const DEFAULT_DURATION_MIN = 60;

const hintOf = (status: string | null | undefined): AvecHint["status"] | null => {
  const g = statusGroup(status);
  return g === "feito" ? "compareceu" : g === "faltou" || g === "cancelado" ? g : g === "ativo" ? "aberto" : null;
};

type Row = {
  id: string; startsAt: Date; duration: number | null; clientName: string | null; contactId: string | null; professional: string | null; service: string; status: string;
  avecStatus: string | null; origin: string; touched: boolean; twinStatus: string | null;
};

export async function noOutcomeToday(now: Date): Promise<NoOutcomeRow[]> {
  const today = todayBahia(now);
  const x = await rows<Row>(sql`
    select a.id, a.starts_at as "startsAt", a.duration_min as duration, coalesce(c.name, a.client_name) as "clientName", a.contact_id as "contactId",
      p.name as professional, a.service_label as service, a.status, a.avec_status as "avecStatus", a.origin, a.crm_touched_at is not null as touched,
      (select t.status from appointments t where t.avec_twin_of = a.id order by t.updated_at desc limit 1) as "twinStatus"
    from appointments a left join contacts c on c.id = a.contact_id left join professionals p on p.id = a.professional_id
    where a.avec_twin_of is null and a.status in (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)})
      and (a.starts_at at time zone 'America/Bahia')::date = ${today}::date
      and a.starts_at + make_interval(mins => coalesce(a.duration_min, ${DEFAULT_DURATION_MIN})::int) <= ${now.toISOString()}::timestamptz
    order by a.starts_at, a.id`);
  // Comanda do Avec no dia: a cliente veio (mesmo contato, ou o mesmo nome quando o horário não tem contato).
  const sold = await rows<{ contactId: string | null; name: string | null }>(sql`
    select distinct si.contact_id as "contactId", si.client_name as name from sales_items si where si.origin = 'avec' and si.sold_on = ${today}::date`);
  const soldContacts = new Set(sold.map((s) => s.contactId).filter(Boolean));
  // Pelo nome só quando um dos lados não tem contato: homônima com outro cadastro não é a mesma cliente.
  const soldNames = new Set(sold.filter((s) => !s.contactId).map((s) => normText(s.name)).filter(Boolean));
  const soldNamesAny = new Set(sold.map((s) => normText(s.name)).filter(Boolean));
  return x.map((a) => {
    const fromStatus = a.twinStatus ? hintOf(a.twinStatus) : a.touched && a.avecStatus ? hintOf(a.avecStatus) : a.origin === "avec" ? hintOf(a.status) : null;
    const name = normText(a.clientName);
    const paid = a.contactId ? soldContacts.has(a.contactId) || (!!name && soldNames.has(name)) : !!name && soldNamesAny.has(name);
    const avec: AvecHint | null = fromStatus && fromStatus !== "aberto" ? { status: fromStatus, why: "status" }
      : paid ? { status: "compareceu", why: "comanda" } : fromStatus ? { status: fromStatus, why: "status" } : null;
    const start = new Date(a.startsAt);
    return {
      id: a.id, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + (a.duration ?? DEFAULT_DURATION_MIN) * 60_000).toISOString(),
      clientName: a.clientName?.trim() || "Cliente", contactId: a.contactId, professional: a.professional, service: a.service, status: a.status, avec,
      suggest: avec?.status === "compareceu" || avec?.status === "faltou" ? avec.status : null,
    };
  });
}

export type OpenComandaRow = { id: string; day: string; number: number; clientName: string; itens: number; totalCents: number | null; paidCents: number };

/**
 * Comandas abertas até hoje (as de dias anteriores também: o fechamento do caixa conta todas), a mais antiga primeiro. A vazia (sem item
 * vivo nem pagamento) nunca é pendência (QA r58, I-8).
 */
export async function openComandasUntil(today: string): Promise<OpenComandaRow[]> {
  // O desconto da comanda não passa do que não é dívida (como em comandaTotals).
  const x = await rows<{ id: string; day: string; number: number; client: string | null; discount: number; itens: number; total: number | null; paid: number }>(sql`
    select c.id, c.day::text as day, c.number, c.client_name as client,
      least(c.discount_cents, coalesce((select sum(greatest(0, round(ci.qty * ci.unit_cents) - ci.discount_cents)) from comanda_items ci
        where ci.comanda_id = c.id and ci.cancelled_at is null and ci.kind <> 'divida'), 0))::int as discount,
      (select count(*) from comanda_items ci where ci.comanda_id = c.id and ci.cancelled_at is null)::int as itens,
      (select sum(greatest(0, round(ci.qty * ci.unit_cents) - ci.discount_cents)) from comanda_items ci where ci.comanda_id = c.id and ci.cancelled_at is null)::int as total,
      (select coalesce(sum(cp.value_cents), 0) from comanda_payments cp where cp.comanda_id = c.id and cp.cancelled_at is null)::int as paid
    from comandas c where c.status = 'aberta' and c.day <= ${today}::date and ${notEmptySql(sql.raw("c.id"))}
    order by c.day, c.number`);
  return x.map((c) => ({ id: c.id, day: c.day, number: c.number, clientName: c.client?.trim() || "Cliente de balcão", itens: c.itens, totalCents: Math.max(0, (c.total ?? 0) - c.discount), paidCents: c.paid }));
}

export type CashStep = { mode: "avec" }
  | { mode: "crm"; open: { id: string; openedByName: string; openedAt: string; openComandas: number;
        /** Contagem cega: quem não é gestão não recebe o esperado (como no Caixa). */ blind?: boolean; expected?: CashSummary["expected"] | null; byBrand?: CashSummary["byBrand"] } | null;
      /** Gestão (caixa.gerir): os caixas abertos das outras pessoas, para fechar dali (QA r58, I-3). Vazio para a equipe. */ team: TeamCashRow[]; canGerir?: boolean };

/** Passo 3: o caixa de quem está fechando o dia (caixa por pessoa, plano 3) e, para a gestão, os caixas abertos da equipe. */
export async function cashStep(viewer: { id: string; perms: readonly string[] }): Promise<CashStep> {
  if ((await getCaixaMode()) !== "crm") return { mode: "avec" };
  const team = can(viewer.perms, "caixa.gerir") ? (await listTeamCash()).filter((r) => r.status === "aberto" && r.personId !== viewer.id) : [];
  const s = await getOpenCashTx(db, viewer.id);
  if (!s) return { mode: "crm", open: null, team, canGerir: can(viewer.perms, "caixa.gerir") };
  const [sum, [who]] = await Promise.all([cashSummary(s.id), rows<{ name: string }>(sql`select coalesce(initcap(lower(signature)), name) as name from users where id = ${s.openedBy}`)]);
  const blind = isBlindFor(await getCaixaRules(), viewer);
  return { mode: "crm", open: { id: s.id, openedByName: who?.name ?? "Alguém", openedAt: s.openedAt.toISOString(), openComandas: sum.openComandas,
    blind, expected: blind ? null : sum.expected, byBrand: blind ? [] : sum.byBrand }, team, canGerir: can(viewer.perms, "caixa.gerir") };
}

/** Os três passos de uma vez (a página). */
export async function loadFecharDia(viewer: { id: string; perms: readonly string[] }, now = new Date()) {
  const today = dayOf(now);
  const [noOutcome, comandas, cash] = await Promise.all([noOutcomeToday(now), openComandasUntil(today), cashStep(viewer)]);
  return { today, noOutcome, comandas, cash };
}
