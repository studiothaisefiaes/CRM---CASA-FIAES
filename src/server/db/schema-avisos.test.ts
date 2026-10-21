import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from ".";

describe("índices dos avisos (lote 16/10)", () => {
  it("avisos abertos por conversa têm índice (a Fila, o sino e as resoluções filtram por deal_id e resolved_at is null)", async () => {
    const r = await db.execute(sql`select indexdef from pg_indexes where indexname = 'alerts_deal_aberto_idx'`);
    expect(r.rows).toHaveLength(1);
    expect((r.rows[0] as { indexdef: string }).indexdef).toMatch(/\(deal_id\) WHERE \(resolved_at IS NULL\)/);
  });
  it("um aviso 'escreveu' aberto por conversa (índice único parcial)", async () => {
    const r = await db.execute(sql`select indexdef from pg_indexes where indexname = 'alerts_mensagem_cliente_aberto_uq'`);
    expect((r.rows[0] as { indexdef: string }).indexdef).toContain("UNIQUE");
  });
});
