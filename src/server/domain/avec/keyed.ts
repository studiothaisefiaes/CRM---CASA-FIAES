import { inArray, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "../../db";
import { inChunks } from "./context";

/**
 * Grava linhas com chave externa determinística: cria as que não existem e, nas que existem, aplica só o que `merge` decidir
 * (completar vazios, avançar status…). Nada muda quando o mesmo arquivo é importado de novo. Devolve quantas linhas foram
 * criadas (`created`, o que o resumo mostra: a mesma reserva vista em dois relatórios conta uma vez) e criadas ou alteradas (`changed`).
 */
type KeyedTable = PgTable & { id: PgColumn; externalKey: PgColumn };
type Row = Record<string, unknown> & { externalKey: string };

const same = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? new Date(a as Date).getTime() === new Date(b as Date).getTime() : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Campos vazios no existente que o novo preenche. */
export function fillEmpty<T extends Record<string, unknown>>(old: Record<string, unknown>, inc: T, fields: (keyof T & string)[]): Partial<T> {
  const patch: Partial<T> = {};
  for (const f of fields) if ((old[f] == null || old[f] === "") && inc[f] != null && inc[f] !== "") patch[f] = inc[f];
  return patch;
}

/** Junta linhas repetidas (mesma chave) do arquivo: a primeira vale, as seguintes só completam o que faltou. */
function dedupe<T extends Row>(rows: T[]): T[] {
  const by = new Map<string, T>();
  for (const r of rows) {
    const prev = by.get(r.externalKey);
    if (!prev) { by.set(r.externalKey, { ...r }); continue; }
    for (const [k, v] of Object.entries(r)) if ((prev[k] == null || prev[k] === "") && v != null && v !== "") (prev as Record<string, unknown>)[k] = v;
  }
  return [...by.values()];
}

export async function upsertKeyed<T extends Row>(
  tx: Tx, table: KeyedTable, rows: T[], merge: (old: Record<string, unknown>, inc: T) => Partial<T>,
): Promise<{ changed: number; created: number; ids: Map<string, string> }> {
  const incoming = dedupe(rows);
  const ids = new Map<string, string>();
  if (!incoming.length) return { changed: 0, created: 0, ids };
  const existing = await inChunks(incoming.map((r) => r.externalKey), 1000, (keys) =>
    tx.select().from(table as PgTable).where(inArray(table.externalKey, keys)) as unknown as Promise<Record<string, unknown>[]>);
  const byKey = new Map(existing.map((e) => [e.externalKey as string, e]));
  let changed = 0;
  const fresh: T[] = [];
  for (const inc of incoming) {
    const old = byKey.get(inc.externalKey);
    if (!old) { fresh.push(inc); continue; }
    ids.set(inc.externalKey, old.id as string);
    const patch = Object.fromEntries(Object.entries(merge(old, inc)).filter(([k, v]) => v !== undefined && !same(old[k], v)));
    if (!Object.keys(patch).length) continue;
    if ("updatedAt" in old) patch.updatedAt = new Date();
    await tx.update(table).set(patch as never).where(eq(table.id, old.id as string));
    changed++;
  }
  const created = await inChunks(fresh, 500, (chunk) =>
    tx.insert(table).values(chunk as never).onConflictDoNothing().returning({ id: table.id, externalKey: table.externalKey }) as unknown as Promise<{ id: string; externalKey: string }[]>);
  for (const c of created) ids.set(c.externalKey, c.id);
  return { changed: changed + created.length, created: created.length, ids };
}
