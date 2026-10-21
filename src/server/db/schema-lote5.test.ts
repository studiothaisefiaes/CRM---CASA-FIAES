import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { db } from ".";

const cols = async (t: string) => ((await db.execute(sql`select column_name from information_schema.columns where table_name = ${t}`)).rows as { column_name: string }[]).map((r) => r.column_name);

describe("Lote 5 (paridade ChatGuru): schema", () => {
  it("notas internas da conversa", async () => {
    expect(await cols("contact_notes")).toEqual(expect.arrayContaining(["id", "contact_id", "deal_id", "author_id", "author_name", "body", "mentions", "source", "external_key", "created_at"]));
  });
  it("Resolvido, reações e quem agendou a mensagem", async () => {
    expect(await cols("deals")).toEqual(expect.arrayContaining(["resolved_at", "resolved_by_id"]));
    expect(await cols("messages")).toContain("reactions");
    expect(await cols("outbox")).toContain("created_by");
  });
  it("mensagem em massa", async () => {
    expect(await cols("campaigns")).toEqual(expect.arrayContaining(["name", "body", "status", "interval_seconds", "audience", "total", "start_at", "created_by", "confirmed_by", "confirmed_at", "finished_at"]));
    expect(await cols("campaign_recipients")).toEqual(expect.arrayContaining(["campaign_id", "contact_id", "status", "message_id", "error", "sent_at"]));
  });
  it("ligações: dados da ligação na mensagem e a anotação ligada a ela", async () => {
    expect(await cols("messages")).toContain("call");
    expect(await cols("contact_notes")).toEqual(expect.arrayContaining(["message_id", "subject"]));
  });
  it("a mesma anotação importada não entra duas vezes", async () => {
    const r = await db.execute(sql`select indexdef from pg_indexes where indexname = 'contact_notes_external_uq'`);
    expect((r.rows[0] as { indexdef: string }).indexdef).toContain("external_key IS NOT NULL");
  });
});
