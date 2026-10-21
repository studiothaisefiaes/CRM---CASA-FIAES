import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from ".";
import { cashMovements, cashSessions, users } from "./schema";
import { resetDb } from "../../../test/db";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
  it("quem atende: assinatura, por onde saiu e quem respondeu por último", async () => {
    expect(await cols("users")).toContain("signature");
    expect(await cols("messages")).toContain("sent_via");
    expect(await cols("deals")).toEqual(expect.arrayContaining(["last_reply_by_id", "last_reply_via"]));
    const r = await db.execute(sql`select indexname, indexdef from pg_indexes where indexname in ('users_signature_uq', 'messages_sent_by_idx')`);
    const m = Object.fromEntries((r.rows as { indexname: string; indexdef: string }[]).map((x) => [x.indexname, x.indexdef]));
    expect(m.users_signature_uq).toContain("upper(signature)");
    expect(m.messages_sent_by_idx).toContain("sent_by_user_id");
  });
  it("funil novo (Lote 1C): tipos de etapa e contador de tentativas", async () => {
    expect(await cols("deals")).toEqual(expect.arrayContaining(["followup_attempt", "followup_due_at", "followup_task_id"]));
    const kinds = ((await db.execute(sql`select unnest(enum_range(null::stage_kind))::text as k`)).rows as { k: string }[]).map((r) => r.k);
    expect(kinds).toEqual(expect.arrayContaining(["proposta", "atendido", "retorno"]));
  });
  it("ficha da cliente (Lote 2): colunas do contato e a visão por contato", async () => {
    expect(await cols("contacts")).toEqual(expect.arrayContaining(["preferred_professional_id", "alert_notes"]));
    expect(await cols("contact_stats")).toEqual(expect.arrayContaining([
      "contact_id", "visits", "first_visit_on", "last_visit_on", "rhythm_days", "cycle_days", "return_due_on", "no_shows", "cancellations",
      "tickets", "total_cents", "preferred_professional_id", "preferred_professional_name", "preferred_share", "service_count", "top_services",
      "origin_label", "avec_professional_hint", "debt_cents", "debt_count", "last_debt_on", "credit_cents", "credit_count", "computed_at",
    ]));
  });
  it("apagar o contato apaga a linha dele na visão; apagar a profissional só limpa a escolha", async () => {
    const [p] = (await db.execute(sql`insert into professionals (name) values ('PROFISSIONAL TESTE') returning id`)).rows as { id: string }[];
    const [c] = (await db.execute(sql`insert into contacts (name, phone_e164, preferred_professional_id) values ('Rita Fictícia', '+5571966000901', ${p.id}) returning id`)).rows as { id: string }[];
    await db.execute(sql`insert into contact_stats (contact_id, visits) values (${c.id}, 3)`);
    await db.execute(sql`delete from professionals where id = ${p.id}`);
    expect(((await db.execute(sql`select preferred_professional_id from contacts where id = ${c.id}`)).rows[0] as { preferred_professional_id: string | null }).preferred_professional_id).toBeNull();
    await db.execute(sql`delete from contacts where id = ${c.id}`);
    expect((await db.execute(sql`select 1 from contact_stats where contact_id = ${c.id}`)).rows).toHaveLength(0);
  });
  it("Lotes 3 e 4: comissão no item, cor da etiqueta, perfis e tentativas da etapa", async () => {
    expect(await cols("sales_items")).toEqual(expect.arrayContaining(["commission_pct", "commission_cents"]));
    expect(await cols("tags")).toContain("color");
    expect(await cols("stages")).toEqual(expect.arrayContaining(["visible_profile_ids", "attempt_days"]));
    const types = (await db.execute(sql`select column_name::text as column_name, data_type::text as data_type, numeric_precision::int as numeric_precision,
      numeric_scale::int as numeric_scale from information_schema.columns
      where table_name = 'sales_items' and column_name in ('commission_pct', 'commission_cents') order by column_name`)).rows;
    expect(types).toEqual([
      { column_name: "commission_cents", data_type: "integer", numeric_precision: 32, numeric_scale: 0 },
      { column_name: "commission_pct", data_type: "numeric", numeric_precision: 5, numeric_scale: 2 },
    ]);
  });
  it("agenda base (Lote 6A): folga, horário, cor, ordem, origem dos vínculos e bloqueios do CRM", async () => {
    expect(await cols("lists")).toContain("buffer_min");
    expect(await cols("professionals")).toEqual(expect.arrayContaining(["work_hours", "color", "agenda_position"]));
    expect(await cols("professional_services")).toEqual(expect.arrayContaining(["source", "created_at", "created_by"]));
    expect(await cols("agenda_blocks")).toEqual(expect.arrayContaining(["origin", "reason", "created_by", "updated_at", "updated_by", "deleted_at", "deleted_by"]));
    const r = await db.execute(sql`select indexdef from pg_indexes where indexname = 'agenda_blocks_live_idx'`);
    expect((r.rows as { indexdef: string }[])[0]?.indexdef).toContain("deleted_at IS NULL");
    // Bloqueios e vínculos que já existem continuam valendo: do Avec e feitos à mão.
    const d = await db.execute(sql`select column_name, column_default from information_schema.columns where (table_name, column_name) in (('agenda_blocks', 'origin'), ('professional_services', 'source'))`);
    expect(Object.fromEntries((d.rows as { column_name: string; column_default: string }[]).map((x) => [x.column_name, x.column_default]))).toEqual({ origin: "'avec'::text", source: "'manual'::text" });
  });
  it("agenda viva (Lote 6B): visita e ciclo de vida do horário", async () => {
    expect(await cols("visits")).toEqual(expect.arrayContaining(["contact_id", "client_name", "day", "deal_id", "notes", "origin", "request_key", "created_by", "created_at", "updated_at"]));
    expect(await cols("appointments")).toEqual(expect.arrayContaining([
      "visit_id", "buffer_min", "fit_in", "fit_in_by", "outside_hours", "any_pro", "confirmed_at", "confirmed_via", "arrived_at", "started_at", "finished_at",
      "cancelled_at", "cancel_reason", "cancel_note", "cancelled_by", "cancelled_via", "created_by", "updated_by", "crm_touched_at", "avec_twin_of",
      "wait_window", "wait_result_appointment_id", "preference",
    ]));
    expect(await cols("professionals")).toContain("photo_path");
    const r = await db.execute(sql`select indexname, indexdef from pg_indexes where indexname in ('visits_request_key_uq', 'visits_contact_day_idx', 'appointments_twin_idx', 'appointments_pro_starts_idx', 'appointments_visit_idx', 'appointments_contact_starts_idx')`);
    const m = Object.fromEntries((r.rows as { indexname: string; indexdef: string }[]).map((x) => [x.indexname, x.indexdef]));
    expect(Object.keys(m).sort()).toEqual(["appointments_contact_starts_idx", "appointments_pro_starts_idx", "appointments_twin_idx", "appointments_visit_idx", "visits_contact_day_idx", "visits_request_key_uq"]);
    expect(m.visits_request_key_uq).toContain("request_key IS NOT NULL");
    expect(m.appointments_twin_idx).toContain("avec_twin_of IS NOT NULL");
  });

  it("0031 só acrescenta (nada de DROP, troca de tipo ou SET NOT NULL)", () => {
    const dir = path.join(__dirname, "../../../drizzle");
    const file = readdirSync(dir).find((f) => f.endsWith("_agenda_viva.sql"));
    expect(file).toBeDefined();
    expect(readFileSync(path.join(dir, file!), "utf8")).not.toMatch(/\bDROP\b|ALTER COLUMN|SET NOT NULL|RENAME/i);
  });
  it("comanda e caixa (Lote 6C): tabelas, colunas, índices e travas", async () => {
    await resetDb();
    for (const t of ["cash_sessions", "cash_movements", "package_defs", "comandas", "comanda_items", "comanda_payments", "client_credit_entries"]) expect((await cols(t)).length).toBeGreaterThan(0);
    expect(await cols("comandas")).toEqual(expect.arrayContaining(["day", "number", "contact_id", "client_name", "visit_id", "status", "discount_cents", "subtotal_cents", "total_cents", "paid_cents", "change_cents", "cash_session_id", "request_key", "opened_by", "closed_by", "cancel_reason", "updated_at"]));
    expect(await cols("comanda_items")).toEqual(expect.arrayContaining(["kind", "label", "service_id", "appointment_id", "professional_id", "qty", "unit_cents", "discount_cents", "total_cents", "client_package_id", "package_def_id", "commission_bp", "commission_base_cents", "commission_cents", "added_via", "cancelled_at"]));
    expect(await cols("professional_services")).toContain("commission_bp");
    expect(await cols("client_packages")).toEqual(expect.arrayContaining(["package_def_id", "comanda_item_id", "unit_cents", "cancelled_at"]));
    expect(await cols("package_uses")).toEqual(expect.arrayContaining(["comanda_item_id", "professional_id", "origin", "cancelled_at"]));
    const r = await db.execute(sql`select indexname from pg_indexes where indexname in ('cash_sessions_one_open', 'cash_sessions_one_open_per_person', 'comanda_payments_session_idx', 'comandas_day_number_uq', 'comandas_open_visit_uq', 'comandas_request_key_uq', 'comanda_items_comanda_idx', 'comanda_items_pro_idx', 'comanda_items_appointment_idx', 'comanda_payments_comanda_idx', 'client_credit_contact_idx')`);
    expect((r.rows as { indexname: string }[]).map((x) => x.indexname).sort()).toEqual(["cash_sessions_one_open_per_person", "client_credit_contact_idx", "comanda_items_appointment_idx", "comanda_items_comanda_idx", "comanda_items_pro_idx", "comanda_payments_comanda_idx", "comanda_payments_session_idx", "comandas_day_number_uq", "comandas_open_visit_uq", "comandas_request_key_uq"]);
    // Plano 3 (0055): um caixa aberto POR PESSOA; o pagamento sabe em que caixa entrou; nota fiscal futura (tipo do item, CPF).
    expect(await cols("comanda_payments")).toEqual(expect.arrayContaining(["cash_session_id", "brand", "note", "custom_method_id", "change_cents", "cancelled_by", "cancel_reason"]));
    expect(await cols("comanda_items")).toEqual(expect.arrayContaining(["original_unit_cents", "price_reason", "discount_reason", "fiscal_kind"]));
    expect(await cols("comandas")).toEqual(expect.arrayContaining(["cpf", "discount_reason", "reopened_by", "reopened_at", "reopen_reason"]));
    expect(await cols("cash_sessions")).toEqual(expect.arrayContaining(["counted_breakdown", "approved_by", "approved_at", "blind"]));
    expect(await cols("payment_method_options")).toEqual(expect.arrayContaining(["id", "label", "active", "position", "created_by", "created_at"]));
    const [u, outra] = await db.insert(users).values([{ name: "Caixa", email: "caixa@c.com", role: "gestor", passwordHash: "x" }, { name: "Outra", email: "outra@c.com", role: "atendente", passwordHash: "x" }]).returning();
    await db.insert(cashSessions).values({ day: "2026-10-16", openedBy: u.id });
    await expect(db.insert(cashSessions).values({ day: "2026-10-16", openedBy: u.id })).rejects.toThrow();
    await db.insert(cashSessions).values({ day: "2026-10-16", openedBy: outra.id }); // outra pessoa abre o dela
    await expect(db.execute(sql`insert into comandas (day, number, opened_by, cpf) values ('2026-10-16', 1, ${u.id}, '123')`)).rejects.toThrow();
    const [s] = await db.select().from(cashSessions).where(eq(cashSessions.openedBy, u.id));
    await expect(db.insert(cashMovements).values({ cashSessionId: s.id, kind: "sangria", valueCents: 0, reason: "x", createdBy: u.id })).rejects.toThrow();
    await expect(db.execute(sql`update professional_services set commission_bp = 10001`)).resolves.toBeTruthy(); // sem linhas, não quebra
  });

  it("0032 só acrescenta (nada de DROP, troca de tipo ou SET NOT NULL)", () => {
    const dir = path.join(__dirname, "../../../drizzle");
    const file = readdirSync(dir).find((f) => f.endsWith("_comanda_caixa.sql"));
    expect(file).toBeDefined();
    expect(readFileSync(path.join(dir, file!), "utf8")).not.toMatch(/\bDROP\b|ALTER COLUMN|SET NOT NULL|RENAME/i);
  });

  it("app da profissional (Lote 7A): ligação com a usuária, avisos, 'vi minha agenda', anotações e pedidos de folga", async () => {
    expect(await cols("professionals")).toContain("user_id");
    expect(await cols("pro_notifications")).toEqual(expect.arrayContaining(["id", "user_id", "professional_id", "kind", "appointment_id", "title", "body", "url", "dedupe_key", "hold_until", "created_at", "pushed_at", "read_at"]));
    expect(await cols("pro_day_acks")).toEqual(expect.arrayContaining(["professional_id", "day", "acked_at", "acked_by"]));
    expect(await cols("client_notes")).toEqual(expect.arrayContaining(["id", "contact_id", "author_id", "professional_id", "appointment_id", "body", "media_path", "media_mime", "created_at", "deleted_at", "deleted_by"]));
    expect(await cols("agenda_blocks")).toEqual(expect.arrayContaining(["request_status", "requested_by", "decided_by", "decided_at", "decision_note"]));
    const r = await db.execute(sql`select indexname, indexdef from pg_indexes where indexname in ('professionals_user_uq', 'pro_notifications_dedupe_uq', 'pro_notifications_pending_idx', 'client_notes_contact_idx')`);
    const m = Object.fromEntries((r.rows as { indexname: string; indexdef: string }[]).map((x) => [x.indexname, x.indexdef]));
    expect(m.professionals_user_uq).toContain("user_id IS NOT NULL");
    expect(m.pro_notifications_dedupe_uq).toContain("UNIQUE");
    expect(m.pro_notifications_pending_idx).toContain("(pushed_at, hold_until)");
    expect(m.client_notes_contact_idx).toContain("(contact_id, created_at)");
    const pk = await db.execute(sql`select count(*)::int as n from information_schema.table_constraints where table_name = 'pro_day_acks' and constraint_type = 'PRIMARY KEY'`);
    expect((pk.rows[0] as { n: number }).n).toBe(1);
    const ck = await db.execute(sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'client_notes_body_len'`);
    expect((ck.rows[0] as { def: string }).def).toContain("2000");
  });

  it("área da cliente (Lote 7B): link da visita guardando só o hash do token", async () => {
    const c = await cols("client_links");
    expect(c).toEqual(expect.arrayContaining(["id", "token_hash", "visit_id", "issued_starts_at", "created_by", "created_via", "created_at", "expires_at", "revoked_at", "open_count", "first_opened_at", "last_opened_at", "last_action", "last_action_at"]));
    expect(c).not.toContain("token");
    const r = await db.execute(sql`select indexname, indexdef from pg_indexes where indexname in ('client_links_token_uq', 'client_links_visit_idx')`);
    const m = Object.fromEntries((r.rows as { indexname: string; indexdef: string }[]).map((x) => [x.indexname, x.indexdef]));
    expect(m.client_links_token_uq).toContain("UNIQUE");
    expect(m.client_links_visit_idx).toContain("(visit_id)");
  });

  it("0033 só acrescenta (nada de DROP, troca de tipo ou SET NOT NULL)", () => {
    const dir = path.join(__dirname, "../../../drizzle");
    const file = readdirSync(dir).find((f) => f.endsWith("_app_profissional.sql"));
    expect(file).toBeDefined();
    expect(readFileSync(path.join(dir, file!), "utf8")).not.toMatch(/\bDROP\b|ALTER COLUMN|SET NOT NULL|RENAME/i);
  });

  it("0034 só acrescenta (nada de DROP, troca de tipo ou SET NOT NULL)", () => {
    const dir = path.join(__dirname, "../../../drizzle");
    const file = readdirSync(dir).find((f) => f.endsWith("_area_cliente.sql"));
    expect(file).toBeDefined();
    expect(readFileSync(path.join(dir, file!), "utf8")).not.toMatch(/\bDROP\b|ALTER COLUMN|SET NOT NULL|RENAME/i);
  });
});

const drizzleDir = path.join(__dirname, "../../../drizzle");
const migrationFile = (prefix: string) => path.join(drizzleDir, readdirSync(drizzleDir).find((f) => f.startsWith(prefix) && f.endsWith(".sql"))!);
/** Roda só os trechos que começam com `starts` (o resto das migrations já rodou no globalSetup e não é idempotente em tabelas truncadas). */
async function runStatements(file: string, starts: RegExp) {
  for (const part of readFileSync(file, "utf8").split("--> statement-breakpoint")) {
    const stmt = part.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim();
    if (starts.test(stmt)) await db.execute(sql.raw(stmt));
  }
}

describe("Fase A", () => {
  it("assistentes, taxas, regras, repasse, vales e dívida", async () => {
    expect(await cols("comanda_item_assistants")).toEqual(expect.arrayContaining(["comanda_item_id", "professional_id", "position", "base_cents", "bp", "commission_cents", "payout_id"]));
    expect(await cols("professional_services")).toContain("assistant_bp");
    expect(await cols("payment_fees")).toEqual(expect.arrayContaining(["method", "brand", "parcelado", "fee_bp"]));
    expect(await cols("comanda_payments")).toEqual(expect.arrayContaining(["fee_bp", "fee_cents"]));
    expect(await cols("comanda_items")).toEqual(expect.arrayContaining(["commission_gross_cents", "commission_deductions", "payout_id", "settles_comanda_id", "commission_held"]));
    expect(await cols("professionals")).toEqual(expect.arrayContaining(["commission_rules", "payout_period"]));
    expect(await cols("lists")).toContain("cost_cents");
    expect(await cols("commission_payouts")).toEqual(expect.arrayContaining(["number", "until_day", "net_cents", "carried_cents", "cancelled_at", "receipt"]));
    expect(await cols("professional_adjustments")).toEqual(expect.arrayContaining(["kind", "rule_id", "cash_movement_id", "carried_from_payout_id", "payout_id"]));
    expect(await cols("professional_adjustment_rules")).toContain("day_of_month");
    expect(await cols("client_debt_entries")).toEqual(expect.arrayContaining(["comanda_id", "delta_cents", "paid_in_comanda_id"]));
    expect(await cols("comandas")).toContain("debt_cents");
  });

  it("taxas da Casa e regras da comissão vêm na migration", async () => {
    await resetDb();
    await runStatements(migrationFile("0062"), /^INSERT/i);
    await runStatements(migrationFile("0063"), /^INSERT/i);
    const value = ((await db.execute(sql`select value from settings where key = 'comissao_regras'`)).rows[0] as { value: unknown }).value;
    expect(value).toMatchObject({ cartao: "antes", antecipacaoBp: 700, custo: "depois", doisAssistentes: "metade", divida: "quitacao" });
    const fees = (await db.execute(sql`select method, brand, parcelado, fee_bp from payment_fees order by 1, 3, 2`)).rows;
    expect(fees).toEqual(expect.arrayContaining([
      { method: "debito", brand: "visa", parcelado: false, fee_bp: 199 },
      { method: "credito", brand: "mastercard", parcelado: false, fee_bp: 210 },
      { method: "credito", brand: "hipercard", parcelado: true, fee_bp: 570 },
    ]));
    expect(fees).toHaveLength(13);
  });

  it("0061 a 0066 só acrescentam (nada de DROP COLUMN/TABLE, troca de tipo ou RENAME)", () => {
    for (const n of ["0061", "0062", "0063", "0064", "0065", "0066", "0067", "0068"]) {
      expect(readFileSync(migrationFile(n), "utf8"), n).not.toMatch(/\bDROP (COLUMN|TABLE)\b|ALTER COLUMN|RENAME/i);
    }
  });

  it("0067 dá as permissões novas por perfil, só onde faltam, e rodar de novo não duplica", async () => {
    await resetDb();
    const mk = (key: string | null, name: string, permissions: string[]) =>
      db.execute(sql`insert into profiles (key, name, permissions, is_system) values (${key}, ${name}, ${sql.raw(`'{${permissions.join(",")}}'::text[]`)}, ${key !== null})`);
    await db.execute(sql`delete from profiles`);
    await mk("gestao", "Gestão", ["caixa.operar", "caixa.gerir"]);
    await mk(null, "Operadora", ["caixa.operar", "caixa.dinheiro"]);
    await mk(null, "Chefe do caixa", ["caixa.gerir"]);
    await mk(null, "Admin", ["config.sistema"]);
    await mk(null, "Financeiro", ["relatorios.ver", "valores.ver"]);
    await mk(null, "Só relatório", ["relatorios.ver"]);
    await mk(null, "Vazia", []);
    const run = () => runStatements(migrationFile("0067"), /^UPDATE/i);
    await run();
    await run();
    const perms = async (name: string) => ((await db.execute(sql`select permissions from profiles where name = ${name}`)).rows[0] as { permissions: string[] }).permissions.sort();
    expect(await perms("Gestão")).toEqual(["caixa.assistente", "caixa.dinheiro", "caixa.divida", "caixa.gerir", "caixa.operar", "caixa.outros", "caixa.taxas", "caixa.vale", "comissao.lancar", "comissao.pagar"]);
    expect(await perms("Operadora")).toEqual(["caixa.assistente", "caixa.dinheiro", "caixa.divida", "caixa.operar", "caixa.vale"]);
    expect(await perms("Chefe do caixa")).toEqual(["caixa.gerir", "caixa.outros", "caixa.taxas"]);
    expect(await perms("Admin")).toEqual(["comissao.regras", "config.sistema"]);
    expect(await perms("Financeiro")).toEqual(["relatorios.excecoes", "relatorios.ver", "valores.ver"]);
    expect(await perms("Só relatório")).toEqual(["relatorios.ver"]);
    expect(await perms("Vazia")).toEqual([]);
    await resetDb();
  });
});
