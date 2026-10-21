import { eq, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { clientCreditEntries } from "../../db/schema";
import { firstName } from "@/lib/authorship";
import { money } from "@/lib/format";
import { lockKeyTx } from "../agenda/locks";
import { UserFacingError } from "../errors";

/** Saldo de crédito da cliente no CRM: a soma dos lançamentos (nunca um valor guardado à parte). */
export async function creditBalance(contactId: string, q: Tx | Db = db): Promise<number> {
  const [r] = await q.select({ s: sql<number>`coalesce(sum(${clientCreditEntries.deltaCents}), 0)::int` }).from(clientCreditEntries).where(eq(clientCreditEntries.contactId, contactId));
  return r?.s ?? 0;
}

export const lockClientCreditTx = (tx: Tx, contactId: string) => lockKeyTx(tx, `credito:${contactId}`);

/** Lança crédito (+) ou uso (−) com a trava da cliente: o saldo nunca fica negativo, nem com dois usos ao mesmo tempo. */
export async function addCreditTx(tx: Tx, e: { contactId: string; deltaCents: number; reason: "troco" | "pagamento" | "estorno" | "ajuste" | "saldo_avec"; comandaId?: string | null; note?: string | null }, actorId: string | null, clientName?: string | null): Promise<void> {
  if (!Number.isInteger(e.deltaCents) || e.deltaCents === 0) throw new UserFacingError("Valor de crédito inválido.");
  await lockClientCreditTx(tx, e.contactId);
  if (e.deltaCents < 0) {
    const balance = await creditBalance(e.contactId, tx);
    if (balance + e.deltaCents < 0) throw new UserFacingError(`Saldo insuficiente: ${firstName(clientName) ?? "a cliente"} tem ${money(balance)} de crédito.`);
  }
  await tx.insert(clientCreditEntries).values({ contactId: e.contactId, deltaCents: e.deltaCents, reason: e.reason, comandaId: e.comandaId ?? null, note: e.note ?? null, createdBy: actorId });
}
