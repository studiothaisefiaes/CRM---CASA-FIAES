import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { contacts, loyaltyEntries, loyaltyPrograms } from "../db/schema";
import { loyaltyOf } from "../domain/fidelidade";
import type { LoyaltyReason, LoyaltyStatusView } from "@/lib/loyalty";

export type LoyaltyHistoryItem = { id: string; at: string; programName: string; delta: number; reason: LoyaltyReason; note: string | null };
export type LoyaltyView = { programs: LoyaltyStatusView[]; history: LoyaltyHistoryItem[] };

/** Fidelidade da ficha da cliente: a situação em cada programa ativo e as últimas 60 linhas do extrato. A função e a permissão são conferidas por quem chama. */
export async function getLoyaltyView(contactId: string, now: Date): Promise<LoyaltyView> {
  const [programs, rows] = await Promise.all([
    loyaltyOf(contactId, now),
    db.select({ e: loyaltyEntries, programName: loyaltyPrograms.name }).from(loyaltyEntries).innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, loyaltyEntries.programId))
      .where(eq(loyaltyEntries.contactId, contactId)).orderBy(desc(loyaltyEntries.createdAt)).limit(60),
  ]);
  return { programs, history: rows.map(({ e, programName }) => ({ id: e.id, at: e.createdAt.toISOString(), programName, delta: e.delta, reason: e.reason, note: e.note })) };
}

export type LoyaltyBalanceRow = { contactId: string; name: string | null; programName: string; balance: number };
export type LoyaltyMovementRow = LoyaltyHistoryItem & { contactId: string; name: string | null };
export type LoyaltyOverview = { balances: LoyaltyBalanceRow[]; movements: LoyaltyMovementRow[] };

/** Fidelidade de todas as clientes (Clientes › Fidelidade): o saldo de cada uma em cada programa (maiores primeiro, até 200) e os últimos 60 movimentos. A função e a permissão são conferidas por quem chama. */
export async function getLoyaltyOverview(): Promise<LoyaltyOverview> {
  const [bal, mov] = await Promise.all([
    db.select({ contactId: loyaltyEntries.contactId, name: contacts.name, programName: loyaltyPrograms.name, balance: sql<number>`sum(${loyaltyEntries.delta})::int` })
      .from(loyaltyEntries).innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, loyaltyEntries.programId)).innerJoin(contacts, eq(contacts.id, loyaltyEntries.contactId))
      .where(eq(loyaltyPrograms.active, true)).groupBy(loyaltyEntries.contactId, contacts.name, loyaltyPrograms.name)
      .having(sql`sum(${loyaltyEntries.delta}) <> 0`).orderBy(sql`sum(${loyaltyEntries.delta}) desc`, contacts.name).limit(200),
    db.select({ e: loyaltyEntries, programName: loyaltyPrograms.name, name: contacts.name }).from(loyaltyEntries)
      .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, loyaltyEntries.programId)).innerJoin(contacts, eq(contacts.id, loyaltyEntries.contactId))
      .orderBy(desc(loyaltyEntries.createdAt)).limit(60),
  ]);
  return {
    balances: bal,
    movements: mov.map(({ e, programName, name }) => ({ id: e.id, at: e.createdAt.toISOString(), programName, delta: e.delta, reason: e.reason, note: e.note, contactId: e.contactId, name })),
  };
}
