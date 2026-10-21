import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { MERGE_HANDLED_FKS } from "./merge-contacts";

describe("Unir cadastros: a trava das tabelas ligadas a contacts", () => {
  it("toda FK para contacts está em MERGE_HANDLED_FKS", async () => {
    const fks = (await db.execute(sql`select tc.table_name || '.' || kcu.column_name as fk from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'contacts' and ccu.column_name = 'id'`)).rows.map((r) => r.fk as string);
    expect(fks.length).toBeGreaterThan(20);
    expect(fks.filter((f) => !MERGE_HANDLED_FKS.includes(f))).toEqual([]);
  });
});
