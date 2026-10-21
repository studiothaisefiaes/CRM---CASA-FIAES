import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, clientDebtEntries, comandaItems, comandas, contacts } from "../../db/schema";
import { money } from "@/lib/format";
import { lockKeyTx } from "../agenda/locks";
import { assertCommissionNotPaidTx } from "./payouts";
import { UserFacingError } from "../errors";

/**
 * Dívida da cliente no CRM (Fase A, item 6; decisão 9): um livro de lançamentos por comanda (`client_debt_entries`). Finalizar com falta
 * lança `+` na comanda que ficou devendo; a quitação (item "divida" numa comanda nova) lança `−` na comanda devida, com a comanda que
 * pagou em `paid_in_comanda_id`. O saldo é sempre a soma (nunca um valor guardado à parte). A dívida do Avec fica no Avec.
 */
export type OpenDebt = { comandaId: string; number: number; day: string; remainingCents: number };

export const lockClientDebtTx = (tx: Tx, contactId: string) => lockKeyTx(tx, `divida:${contactId}`);

/** Quanto a cliente deve no CRM, somando todas as comandas. */
export async function debtBalance(contactId: string, q: Tx | Db = db): Promise<number> {
  const [r] = await q.select({ s: sql<number>`coalesce(sum(${clientDebtEntries.deltaCents}), 0)::int` }).from(clientDebtEntries).where(eq(clientDebtEntries.contactId, contactId));
  return r?.s ?? 0;
}

/** As comandas da cliente com dívida aberta, da mais antiga para a mais nova. */
export async function openDebts(contactId: string, q: Tx | Db = db): Promise<OpenDebt[]> {
  const remaining = sql<number>`sum(${clientDebtEntries.deltaCents})::int`;
  const rows = await q.select({ comandaId: comandas.id, number: comandas.number, day: comandas.day, remainingCents: remaining })
    .from(clientDebtEntries).innerJoin(comandas, eq(comandas.id, clientDebtEntries.comandaId))
    .where(eq(clientDebtEntries.contactId, contactId))
    .groupBy(comandas.id, comandas.number, comandas.day).having(sql`sum(${clientDebtEntries.deltaCents}) > 0`)
    .orderBy(asc(comandas.day), asc(comandas.number));
  return rows.map((r) => ({ comandaId: r.comandaId, number: r.number, day: r.day, remainingCents: r.remainingCents }));
}

export type Debtor = { contactId: string; name: string; totalCents: number; sinceDay: string; comandaId: string; comandaNumber: number; debts: number };

/** "Devendo" no Caixa: as clientes com dívida aberta, a que deve há mais tempo primeiro. `comandaId` é a dívida mais antiga (a que o Receber quita primeiro). */
export async function listDebtors(q: Tx | Db = db): Promise<Debtor[]> {
  const remaining = sql<number>`sum(${clientDebtEntries.deltaCents})::int`;
  const rows = await q.select({ contactId: clientDebtEntries.contactId, name: contacts.name, comandaId: comandas.id, number: comandas.number, day: comandas.day, remainingCents: remaining })
    .from(clientDebtEntries).innerJoin(comandas, eq(comandas.id, clientDebtEntries.comandaId)).innerJoin(contacts, eq(contacts.id, clientDebtEntries.contactId))
    .groupBy(clientDebtEntries.contactId, contacts.name, comandas.id, comandas.number, comandas.day).having(sql`sum(${clientDebtEntries.deltaCents}) > 0`)
    .orderBy(asc(comandas.day), asc(comandas.number));
  const by = new Map<string, Debtor>();
  for (const r of rows) {
    const d = by.get(r.contactId);
    if (d) { d.totalCents += r.remainingCents; d.debts += 1; } else by.set(r.contactId, { contactId: r.contactId, name: r.name ?? "Cliente", totalCents: r.remainingCents, sinceDay: r.day, comandaId: r.comandaId, comandaNumber: r.number, debts: 1 });
  }
  return [...by.values()].sort((a, b) => a.sinceDay.localeCompare(b.sinceDay) || a.name.localeCompare(b.name, "pt-BR"));
}

/** O que ainda falta da dívida daquela comanda (com `contactId`, só a dívida dessa cliente). */
export async function comandaDebtRemaining(comandaId: string, q: Tx | Db = db, contactId?: string): Promise<number> {
  const [r] = await q.select({ s: sql<number>`coalesce(sum(${clientDebtEntries.deltaCents}), 0)::int` }).from(clientDebtEntries)
    .where(and(eq(clientDebtEntries.comandaId, comandaId), contactId ? eq(clientDebtEntries.contactId, contactId) : undefined));
  return r?.s ?? 0;
}

export const debtOverMessage = (remainingCents: number) => `Passa do que falta da dívida (${money(Math.max(0, remainingCents))}).`;

/** Finalizar com falta: lança a dívida da comanda (com a trava da cliente). */
export async function leaveDebtTx(tx: Tx, o: { contactId: string; comandaId: string; cents: number }, actorId: string): Promise<void> {
  await lockClientDebtTx(tx, o.contactId);
  await tx.insert(clientDebtEntries).values({ contactId: o.contactId, comandaId: o.comandaId, deltaCents: o.cents, createdBy: actorId });
}

const COMMISSIONED = ["servico", "pacote_sessao"];

/**
 * Finalizar a comanda que quita: um lançamento `−` por comanda devida, conferido de novo com a trava da cliente (duas comandas quitando
 * a mesma dívida ao mesmo tempo: a segunda é recusada). Se a dívida daquela comanda zerou, a comissão retida dela é liberada.
 */
export async function settleDebtsTx(tx: Tx, o: { contactId: string; paidInComandaId: string; parts: Map<string, number> }, actorId: string, now: Date): Promise<void> {
  if (!o.parts.size) return;
  await lockClientDebtTx(tx, o.contactId);
  for (const [comandaId, cents] of o.parts) {
    const remaining = await comandaDebtRemaining(comandaId, tx, o.contactId);
    if (cents > remaining) throw new UserFacingError(debtOverMessage(remaining));
    await tx.insert(clientDebtEntries).values({ contactId: o.contactId, comandaId, deltaCents: -cents, paidInComandaId: o.paidInComandaId, createdBy: actorId, createdAt: now });
    if (remaining - cents === 0) {
      const released = await tx.update(comandaItems).set({ commissionHeld: false })
        .where(and(eq(comandaItems.comandaId, comandaId), eq(comandaItems.commissionHeld, true))).returning({ id: comandaItems.id });
      if (released.length) await tx.insert(auditLog).values({ userId: actorId, createdAt: now, action: "comissao_liberada", entity: "comanda", entityId: comandaId,
        data: { pelaComanda: o.paidInComandaId, itens: released.length } });
    }
  }
}

/**
 * Reabrir ou cancelar a comanda fechada: (1) se ela deixou dívida, estorna o lançamento (recusa se parte já foi paga); (2) se ela quitou
 * dívidas, devolve cada uma, e a comissão retida da comanda devida volta a esperar a cliente (recusa se essa comissão já foi paga).
 */
export async function undoDebtsTx(tx: Tx, c: { id: string; contactId: string | null }, actorId: string, now: Date): Promise<void> {
  const own = await tx.select().from(clientDebtEntries).where(eq(clientDebtEntries.comandaId, c.id));
  const paidBy = await tx.select().from(clientDebtEntries).where(eq(clientDebtEntries.paidInComandaId, c.id));
  if (!own.length && !paidBy.length) return;
  const contacts = [...new Set([...own, ...paidBy].map((e) => e.contactId))].sort();
  for (const id of contacts) await lockClientDebtTx(tx, id);

  // (1) A dívida desta comanda: nenhuma quitação viva (soma das quitações de cada comanda que pagou = 0).
  if (own.length) {
    const byPayer = new Map<string, number>();
    for (const e of own.filter((x) => x.paidInComandaId)) byPayer.set(e.paidInComandaId!, (byPayer.get(e.paidInComandaId!) ?? 0) + e.deltaCents);
    const payer = [...byPayer.entries()].find(([, v]) => v !== 0)?.[0];
    if (payer) {
      const [p] = await tx.select({ n: comandas.number }).from(comandas).where(eq(comandas.id, payer));
      throw new UserFacingError(`Parte desta dívida já foi paga na comanda ${p?.n ?? "nova"}.`);
    }
    const net = own.reduce((a, e) => a + e.deltaCents, 0);
    if (net !== 0) await tx.insert(clientDebtEntries).values({ contactId: own[0].contactId, comandaId: c.id, deltaCents: -net, createdBy: actorId, createdAt: now });
  }

  // (2) O que esta comanda quitou: devolve (lançamento + com a mesma comanda que pagou, para o "já foi paga" somar zero).
  const parts = new Map<string, { contactId: string; cents: number }>();
  for (const e of paidBy) { const p = parts.get(e.comandaId) ?? { contactId: e.contactId, cents: 0 }; p.cents += e.deltaCents; parts.set(e.comandaId, p); }
  for (const [comandaId, p] of parts) {
    if (p.cents === 0) continue;
    await tx.insert(clientDebtEntries).values({ contactId: p.contactId, comandaId, deltaCents: -p.cents, paidInComandaId: c.id, createdBy: actorId, createdAt: now });
    // A dívida volta a ficar aberta: se a comanda devida reteve a comissão no Finalizar, ela volta a esperar (já paga: recusa).
    if (await retainedAtCloseTx(tx, comandaId)) {
      await assertDueNotPaidTx(tx, comandaId);
      await tx.update(comandaItems).set({ commissionHeld: true })
        .where(and(eq(comandaItems.comandaId, comandaId), inArray(comandaItems.kind, COMMISSIONED), isNotNull(comandaItems.professionalId), isNull(comandaItems.cancelledAt)));
      await tx.insert(auditLog).values({ userId: actorId, createdAt: now, action: "comissao_retida", entity: "comanda", entityId: comandaId, data: { quitacaoDesfeitaNaComanda: c.id } });
    }
  }
}

/** A comanda devida reteve a comissão no Finalizar? (o último "comanda_fechada" dela diz). */
async function retainedAtCloseTx(tx: Tx, comandaId: string): Promise<boolean> {
  const [closed] = await tx.select({ data: auditLog.data }).from(auditLog)
    .where(and(eq(auditLog.action, "comanda_fechada"), eq(auditLog.entityId, comandaId))).orderBy(desc(auditLog.createdAt)).limit(1);
  return !!(closed?.data as { comissaoRetida?: boolean } | null)?.comissaoRetida;
}

/** Voltar a reter uma comissão que já foi paga desfaria o recibo por baixo: recusa (decisão 11, estendida à comanda devida). Trava a devida. */
async function assertDueNotPaidTx(tx: Tx, comandaId: string): Promise<void> {
  const [due] = await tx.select().from(comandas).where(eq(comandas.id, comandaId)).for("update");
  if (due) await assertCommissionNotPaidTx(tx, due, true);
}

/**
 * Antes de reabrir ou cancelar a comanda `payerId`: se ela quitou (de vez, ainda valendo) a dívida de uma comanda que reteve a comissão e
 * essa comissão já foi paga, recusa com o recibo (a mesma conta que `undoDebtsTx` faz depois, chamada cedo para vir antes das outras recusas).
 */
export async function assertSettledCommissionNotPaidTx(tx: Tx, payerId: string): Promise<void> {
  const paidBy = await tx.select().from(clientDebtEntries).where(eq(clientDebtEntries.paidInComandaId, payerId));
  const net = new Map<string, number>();
  for (const e of paidBy) net.set(e.comandaId, (net.get(e.comandaId) ?? 0) + e.deltaCents);
  for (const [comandaId, cents] of net) if (cents !== 0 && (await retainedAtCloseTx(tx, comandaId))) await assertDueNotPaidTx(tx, comandaId);
}
