import { sql } from "drizzle-orm";
import type { Tx } from "../../db";

export type AgendaLockInput = { professionalIds: (string | null | undefined)[]; contactId: string | null | undefined; days: string[] };

/** As chaves das travas: uma por profissional e dia e uma por cliente e dia, sem repetição e sempre na mesma ordem (evita impasse). */
export function agendaLockKeys(i: AgendaLockInput): string[] {
  const keys = new Set<string>();
  for (const d of i.days) {
    for (const p of i.professionalIds) if (p) keys.add(`agenda:pro:${p}:${d}`);
    if (i.contactId) keys.add(`agenda:cli:${i.contactId}:${d}`);
  }
  return [...keys].sort();
}

/** Trava uma chave de texto até o fim da transação. */
export async function lockKeyTx(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** Trava a agenda das profissionais e da cliente nos dias tocados, antes de reler o banco e rodar o motor (6.4, passo 2). */
export async function lockAgendaTx(tx: Tx, i: AgendaLockInput): Promise<void> {
  for (const k of agendaLockKeys(i)) await lockKeyTx(tx, k);
}
