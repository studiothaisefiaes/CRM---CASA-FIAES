import { db } from "../db";
import { ImportCtx } from "../domain/avec/context";
import { COLS, colOf } from "../domain/avec/formats";

/**
 * Liga cada linha de um relatório do Avec guardado à ficha da cliente (Lote 2), com a MESMA regra da importação: telefone primeiro;
 * sem telefone, o nome quando só um contato tem esse nome. Só leitura (transação read only). Sem coluna de cliente, nada vira link.
 */
export async function linkAvecRows(columns: string[], rows: string[][]): Promise<{ clientCol: number; contactIds: (string | null)[] }> {
  const clientCol = colOf(columns, ...COLS.client);
  if (clientCol < 0 || !rows.length) return { clientCol, contactIds: rows.map(() => null) };
  const contactIds = await db.transaction(async (tx) => {
    const ctx = new ImportCtx(tx, columns, rows, []);
    const out: (string | null)[] = [];
    for (const row of rows) out.push(await ctx.contactOf(row)); // em sequência: o ImportCtx guarda o que já achou
    return out;
  }, { accessMode: "read only" });
  return { clientCol, contactIds };
}
