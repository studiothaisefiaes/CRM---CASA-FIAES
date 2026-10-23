import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { comandaItems, comandaPayments, comandas } from "../db/schema";
import { comandaTotals } from "@/lib/comanda-math";
import { todayBahia } from "@/lib/agenda";
import { teamNameOf } from "./team-name";

export type ComandaListStatus = "aberta" | "fechada" | "cancelada" | "divida";
export type ComandaListFilter = { from: string; to: string; status?: ComandaListStatus; q?: string; professionalId?: string; blind: boolean };
export type ComandaListRow = {
  id: string; number: number; day: string; clientName: string; contactId: string | null; status: string;
  /** Null nas pagas HOJE na contagem cega, para quem não é gestão (somadas, dariam o esperado do caixa; mesma regra do `queueFor`). */
  totalCents: number | null; paidCents: number | null;
  /** O que a cliente ainda deve desta comanda (lançamentos de dívida). */ debtCents: number;
  /** Tem dívida em aberto (vale mesmo quando o valor é escondido, sem valores.ver). */ hasDebt: boolean;
  /** Quem atendeu: as profissionais dos itens e as assistentes, sem repetir. */ professionals: string[];
  openedAt: string; closedAt: string | null; closedByName: string | null;
};
export const COMANDAS_LIST_LIMIT = 200;
/** O id da comanda com o nome da tabela: nas subconsultas, o Drizzle escreve só "id" (ambíguo). */
const CID = sql.raw(`"comandas"."id"`);

const DEBT = sql<number>`coalesce((select sum(de.delta_cents) from client_debt_entries de where de.comanda_id = ${CID}), 0)::int`;
const PROS = sql<string[]>`coalesce((select array_agg(distinct p.name order by p.name) from professionals p where p.id in (
  select ci.professional_id from comanda_items ci where ci.comanda_id = ${CID} and ci.cancelled_at is null and ci.professional_id is not null
  union select cia.professional_id from comanda_item_assistants cia join comanda_items ci2 on ci2.id = cia.comanda_item_id where ci2.comanda_id = ${CID} and ci2.cancelled_at is null)), '{}')`;

function conds(f: Partial<ComandaListFilter> & { contactId?: string }): SQL[] {
  const c: SQL[] = [];
  if (f.from) c.push(gte(comandas.day, f.from));
  if (f.to) c.push(lte(comandas.day, f.to));
  if (f.contactId) c.push(eq(comandas.contactId, f.contactId));
  if (f.status === "divida") c.push(sql`${DEBT} > 0`);
  else if (f.status) c.push(eq(comandas.status, f.status));
  if (f.professionalId) c.push(sql`exists (select 1 from comanda_items pi left join comanda_item_assistants pa on pa.comanda_item_id = pi.id
    where pi.comanda_id = ${CID} and pi.cancelled_at is null and (pi.professional_id = ${f.professionalId} or pa.professional_id = ${f.professionalId}))`);
  const q = f.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const or: SQL[] = [sql`${comandas.clientName} ilike ${`%${q.replace(/[\\%_]/g, "\\$&")}%`}`];
    if (/^\d{1,4}$/.test(q)) or.push(eq(comandas.number, Number(q)));
    if (digits.length >= 4) or.push(sql`exists (select 1 from contacts pc where pc.id = "comandas"."contact_id" and pc.phone_e164 like ${`%${digits}%`})`);
    c.push(sql`(${sql.join(or, sql` or `)})`);
  }
  return c;
}

async function rowsOf(where: SQL[], limit: number, blind: boolean, now: Date): Promise<ComandaListRow[]> {
  const rows = await db.select({ c: comandas, closedByName: teamNameOf(comandas.closedBy), debt: DEBT, pros: PROS }).from(comandas)
    .where(and(...where)).orderBy(desc(comandas.day), desc(comandas.number)).limit(limit);
  const ids = rows.map((r) => r.c.id);
  const openIds = rows.filter((r) => r.c.status === "aberta").map((r) => r.c.id);
  const [items, paid] = await Promise.all([
    openIds.length ? db.select().from(comandaItems).where(and(inArray(comandaItems.comandaId, openIds), isNull(comandaItems.cancelledAt))) : [],
    ids.length ? db.select({ id: comandaPayments.comandaId, v: sql<number>`sum(${comandaPayments.valueCents})::int` }).from(comandaPayments)
      .where(and(inArray(comandaPayments.comandaId, ids), isNull(comandaPayments.cancelledAt))).groupBy(comandaPayments.comandaId) : [],
  ]);
  const paidOf = new Map(paid.map((p) => [p.id, p.v]));
  const today = todayBahia(now);
  return rows.map(({ c, closedByName, debt, pros }) => {
    const total = c.status === "aberta"
      ? comandaTotals(items.filter((i) => i.comandaId === c.id).map((i) => ({ id: i.id, label: i.label, qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents, kind: i.kind })), c.discountCents).totalCents
      : c.totalCents ?? 0;
    const hide = blind && c.status === "fechada" && !!c.closedAt && todayBahia(c.closedAt) === today;
    return {
      id: c.id, number: c.number, day: c.day, clientName: c.clientName ?? "Cliente de balcão", contactId: c.contactId, status: c.status,
      totalCents: hide ? null : total, paidCents: hide ? null : paidOf.get(c.id) ?? 0, debtCents: Math.max(0, debt), hasDebt: debt > 0, professionals: pros ?? [],
      openedAt: c.openedAt.toISOString(), closedAt: c.closedAt?.toISOString() ?? null, closedByName,
    };
  });
}

/** Caixa › Comandas (22/10, como "Comandas finalizadas/pendentes" do Avec): por período, situação, profissional e busca; até 200, mais nova primeiro. */
export async function listComandas(f: ComandaListFilter, now = new Date()): Promise<{ rows: ComandaListRow[]; total: number }> {
  const where = conds(f);
  const [rows, [n]] = await Promise.all([rowsOf(where, COMANDAS_LIST_LIMIT, f.blind, now), db.select({ n: sql<number>`count(*)::int` }).from(comandas).where(and(...where))]);
  return { rows, total: n?.n ?? 0 };
}

/** As comandas do CRM na ficha da cliente (só a própria ficha), mais nova primeiro. */
export async function clientComandas(contactId: string, limit = 30, now = new Date()): Promise<ComandaListRow[]> {
  return rowsOf(conds({ contactId }), limit, false, now);
}

