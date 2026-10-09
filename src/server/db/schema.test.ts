import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from ".";
const cols = async (t: string) => ((await db.execute(sql`select column_name from information_schema.columns where table_name = ${t}`)).rows as { column_name: string }[]).map((r) => r.column_name);
describe("migração das melhorias", () => {
  it("deals tem arquivamento, origem, serviço, pago e comparecimento", async () => {
    const c = await cols("deals");
    for (const k of ["archived_at", "archived_by", "archived_stage_id", "source_id", "source_label", "service_id", "paid_at", "paid_cents", "attendance", "attendance_at"]) expect(c).toContain(k);
  });
  it("tabelas novas existem", async () => {
    for (const t of ["lead_sources", "tasks", "push_subscriptions", "outbox"]) expect((await cols(t)).length).toBeGreaterThan(3);
    expect(await cols("alerts")).toEqual(expect.arrayContaining(["wait_key", "level", "escalated_at", "pushed_at"]));
    expect(await cols("channels")).toContain("quiet_until");
    expect(await cols("messages")).toContain("media_purged_at");
    expect(await cols("contacts")).toContain("last_auto_reply_at");
    expect(await cols("lists")).toContain("cycle_days");
  });
  it("pg_trgm ativo", async () => {
    const r = await db.execute(sql`select 1 from pg_extension where extname = 'pg_trgm'`);
    expect(r.rows.length).toBe(1);
  });
  it("índice de lead aberto ignora arquivados e há índices trigram", async () => {
    const r = await db.execute(sql`select indexname, indexdef from pg_indexes where indexname in ('deals_one_open_per_contact','contacts_name_trgm','messages_body_trgm','alerts_wait_uq')`);
    const m = Object.fromEntries((r.rows as { indexname: string; indexdef: string }[]).map((x) => [x.indexname, x.indexdef]));
    expect(m.deals_one_open_per_contact).toContain("archived_at IS NULL");
    expect(m.contacts_name_trgm).toContain("gin_trgm_ops");
    expect(m.messages_body_trgm).toContain("gin_trgm_ops");
    expect(m.alerts_wait_uq).toContain("wait_key IS NOT NULL");
  });
});
