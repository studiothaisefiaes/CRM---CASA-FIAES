import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { auditLog, cashSessions, comandaPayments, comandas, paymentMethodOptions } from "../db/schema";
import { DRAWER_METHODS, PAY_LABEL, PAY_METHODS, type PayMethod } from "@/lib/comanda-math";
import { teamNameOf } from "./team-name";

/**
 * Leituras dos pagamentos do caixa do CRM para Relatórios › Financeiro (Plano 4). Regras comuns:
 * - `range`: dias "AAAA-MM-DD" em Salvador, inclusive; o dia é o do PAGAMENTO (quando o dinheiro entrou), não o da comanda;
 * - contam os pagamentos vivos (sem estorno) de comandas não canceladas, inclusive de comanda ainda aberta (pagamento parcial);
 * - o dinheiro vem líquido do troco devolvido;
 * - `moneyCents` soma só o que é dinheiro que entrou (Dinheiro, Pix, Crédito, Débito e Outra forma): sem cortesia e sem crédito da cliente.
 */
export type PayRange = { from: string; to: string };
export type MethodTotal = { method: PayMethod; label: string; customMethodId: string | null; valueCents: number; /** Taxa do cartão gravada em cada pagamento (0 quando não há). */ feeCents: number; count: number };
export type DayTotal = { day: string; byMethod: Record<PayMethod, number>; moneyCents: number; count: number };
export type SessionTotal = {
  sessionId: string | null; personId: string | null; personName: string; status: "aberto" | "fechado" | "sem_caixa"; openedAt: string | null; closedAt: string | null;
  byMethod: Record<PayMethod, number>; moneyCents: number; differenceCents: number | null; approvedByName: string | null;
};
export type CaixaExceptionKind = "preco_alterado" | "desconto" | "cortesia" | "item_cancelado" | "estorno" | "comanda_reaberta" | "sangria_grande" | "contagem_recusada";
export type CaixaException = {
  at: string; kind: CaixaExceptionKind; userName: string | null; comandaId: string | null; comandaNumber: number | null; item: string | null;
  valueCents: number | null; previousCents: number | null; reason: string | null;
};

const payDay = sql<string>`to_char((${comandaPayments.createdAt} at time zone 'America/Bahia')::date, 'YYYY-MM-DD')`;
const net = sql<number>`sum(${comandaPayments.valueCents} - ${comandaPayments.changeCents})::int`;
const fee = sql<number>`coalesce(sum(${comandaPayments.feeCents}), 0)::int`;
const inRange = (r: PayRange): SQL => sql`(${comandaPayments.createdAt} at time zone 'America/Bahia')::date between ${r.from}::date and ${r.to}::date`;
const live = (r: PayRange) => and(inRange(r), isNull(comandaPayments.cancelledAt), ne(comandas.status, "cancelada"));
const zeros = (): Record<PayMethod, number> => Object.fromEntries(PAY_METHODS.map((m) => [m, 0])) as Record<PayMethod, number>;
const moneyOf = (b: Record<PayMethod, number>) => DRAWER_METHODS.reduce((a, m) => a + b[m], 0);
const methodOrder = (m: string) => PAY_METHODS.indexOf(m as PayMethod);

/** Recebido por forma no período. "Outra forma" sai uma linha por forma cadastrada, com o nome dela. */
export async function paymentsByMethod(range: PayRange): Promise<MethodTotal[]> {
  const rows = await db.select({ method: comandaPayments.method, customMethodId: comandaPayments.customMethodId, label: paymentMethodOptions.label, valueCents: net, feeCents: fee, count: sql<number>`count(*)::int` })
    .from(comandaPayments).innerJoin(comandas, eq(comandas.id, comandaPayments.comandaId)).leftJoin(paymentMethodOptions, eq(paymentMethodOptions.id, comandaPayments.customMethodId))
    .where(live(range)).groupBy(comandaPayments.method, comandaPayments.customMethodId, paymentMethodOptions.label);
  return rows
    .map((r) => ({ method: r.method as PayMethod, label: r.method === "outra" ? r.label ?? PAY_LABEL.outra : PAY_LABEL[r.method as PayMethod] ?? r.method, customMethodId: r.customMethodId, valueCents: r.valueCents, feeCents: r.feeCents, count: r.count }))
    .sort((a, b) => methodOrder(a.method) - methodOrder(b.method) || a.label.localeCompare(b.label, "pt-BR"));
}

/** Recebido por dia (do pagamento) e forma. `count` = quantos pagamentos. */
export async function paymentsByDay(range: PayRange): Promise<DayTotal[]> {
  const rows = await db.select({ day: payDay, method: comandaPayments.method, valueCents: net, count: sql<number>`count(*)::int` })
    .from(comandaPayments).innerJoin(comandas, eq(comandas.id, comandaPayments.comandaId)).where(live(range)).groupBy(payDay, comandaPayments.method);
  const byDay = new Map<string, DayTotal>();
  for (const r of rows) {
    const d = byDay.get(r.day) ?? { day: r.day, byMethod: zeros(), moneyCents: 0, count: 0 };
    d.byMethod[r.method as PayMethod] = (d.byMethod[r.method as PayMethod] ?? 0) + r.valueCents;
    d.count += r.count;
    byDay.set(r.day, d);
  }
  return [...byDay.values()].map((d) => ({ ...d, moneyCents: moneyOf(d.byMethod) })).sort((a, b) => a.day.localeCompare(b.day));
}

/** Recebido por caixa (pessoa) no período; os pagamentos sem caixa aberto saem numa linha "Sem caixa". Ordem: quem abriu primeiro. */
export async function paymentsBySession(range: PayRange): Promise<SessionTotal[]> {
  const rows = await db.select({ sessionId: comandaPayments.cashSessionId, method: comandaPayments.method, valueCents: net })
    .from(comandaPayments).innerJoin(comandas, eq(comandas.id, comandaPayments.comandaId)).where(live(range)).groupBy(comandaPayments.cashSessionId, comandaPayments.method);
  const ids = [...new Set(rows.map((r) => r.sessionId).filter((x): x is string => !!x))];
  const sessions = ids.length ? await db.select({ s: cashSessions, owner: teamNameOf(cashSessions.openedBy), approver: teamNameOf(cashSessions.approvedBy) })
    .from(cashSessions).where(inArray(cashSessions.id, ids)).orderBy(asc(cashSessions.openedAt)) : [];
  const sum = (id: string | null) => {
    const b = zeros();
    for (const r of rows.filter((x) => x.sessionId === id)) b[r.method as PayMethod] += r.valueCents;
    return b;
  };
  const out: SessionTotal[] = sessions.map(({ s, owner, approver }) => {
    const b = sum(s.id);
    return { sessionId: s.id, personId: s.openedBy, personName: owner ?? "—", status: s.status === "aberto" ? "aberto" : "fechado", openedAt: s.openedAt.toISOString(), closedAt: s.closedAt?.toISOString() ?? null,
      byMethod: b, moneyCents: moneyOf(b), differenceCents: s.differenceCents, approvedByName: approver };
  });
  if (rows.some((r) => r.sessionId == null)) {
    const b = sum(null);
    out.push({ sessionId: null, personId: null, personName: "Sem caixa", status: "sem_caixa", openedAt: null, closedAt: null, byMethod: b, moneyCents: moneyOf(b), differenceCents: null, approvedByName: null });
  }
  return out;
}

const EXCEPTION_ACTIONS: Record<string, CaixaExceptionKind> = {
  preco_alterado: "preco_alterado", desconto: "desconto", cortesia: "cortesia", item_cancelado: "item_cancelado", estorno: "estorno",
  comanda_reaberta: "comanda_reaberta", caixa_sangria_grande: "sangria_grande", caixa_contagem_recusada: "contagem_recusada",
};

/** Descontos, cortesias, preços alterados, itens cancelados, estornos, reaberturas, sangrias grandes e contagens recusadas (diferença acima da tolerância, sem aprovação): quem fez, quanto e o motivo. */
export async function listCaixaExceptions(range: PayRange): Promise<CaixaException[]> {
  const rows = await db.select({ a: auditLog, userName: teamNameOf(auditLog.userId), number: comandas.number })
    .from(auditLog).leftJoin(comandas, and(eq(auditLog.entity, "comanda"), sql`${comandas.id}::text = ${auditLog.entityId}`))
    .where(and(inArray(auditLog.action, Object.keys(EXCEPTION_ACTIONS)), sql`(${auditLog.createdAt} at time zone 'America/Bahia')::date between ${range.from}::date and ${range.to}::date`))
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return rows.map(({ a, userName, number }) => {
    const d = a.data ?? {};
    const kind = EXCEPTION_ACTIONS[a.action];
    return {
      at: a.createdAt.toISOString(), kind, userName, comandaId: a.entity === "comanda" ? a.entityId : null, comandaNumber: number ?? null, item: str(d.item),
      valueCents: kind === "preco_alterado" ? num(d.para) : kind === "comanda_reaberta" ? num(d.total) : kind === "contagem_recusada" ? num(d.diferenca) : num(d.valor),
      previousCents: kind === "preco_alterado" ? num(d.de) : null, reason: str(d.motivo),
    };
  });
}
