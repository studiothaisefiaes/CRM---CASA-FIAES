import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { teams } from "@/server/db/schema";
import { seed } from "@/server/db/seed";
import { seedTestServices } from "./fixture-services";

/** Limpa os dados (mantém o schema) e reaplica o seed padrão. */
export async function resetDb() {
  await db.execute(sql`truncate table automation_runs, automation_versions, automations, alerts, deal_events, messages, deals,
    contacts, channels, lists, stages, sessions, users, webhook_events, audit_log, settings, outbox, tasks, lead_sources, push_subscriptions, profiles, report_files, report_print_tokens, tags, contact_tags, professionals, professional_services, chatguru_records,
    contact_notes, campaigns, campaign_recipients,
    appointments, appointment_assistants, appointment_labels, appointment_series, visits, agenda_blocks, avec_rejected_rows, client_packages, package_uses, sales_items, sales_payments, avec_reports, contact_stats,
    cash_movements, comanda_payments, payment_method_options, client_credit_entries, comanda_item_assistants, payment_fees, commission_payouts, professional_adjustments, professional_adjustment_rules, client_debt_entries, comanda_items, comandas, cash_sessions, package_defs, pro_notifications, pro_day_acks, client_notes, client_links, form_questions, form_answers, client_photos, loyalty_programs, loyalty_entries, contact_merges, team_members, teams, library_files, satisfaction_answers, deal_follows , expenses, bank_accounts, finance_categories, stock_movements, products, fiscal_documents, fiscal_sequences restart identity cascade`);
  await seed(db);
  await seedTestServices(db);
  // Os setores vêm da migration 0069 em produção; o truncate acima os apaga, então o banco de teste os recria aqui.
  await db.insert(teams).values(["Recepção", "Método Fiaes®", "Serviços gerais"].map((name, i) => ({ name, position: i + 1 })));
}
