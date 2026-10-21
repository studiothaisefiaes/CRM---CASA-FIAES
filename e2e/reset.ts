import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "../src/server/db";
import { seed } from "../src/server/db/seed";
import { lists, professionals, professionalServices, profiles, settings, users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { seedTestServices } from "../test/fixture-services";
import { seedAgendaE2E } from "./seed-agenda";

// Banco de e2e limpo: gestão + uma atendente.
async function main() {
  // crm_perf*: o banco da medição (scripts/perf-conversa.mjs).
  if (!/\/crm_(e2e|perf)/.test(process.env.DATABASE_URL ?? "")) throw new Error("reset só roda no banco crm_e2e (ou crm_perf da medição)");
  await db.execute(sql`truncate table automation_runs, automation_versions, automations, alerts, deal_events, messages, deals,
    contacts, channels, lists, stages, sessions, users, webhook_events, audit_log, settings, outbox, tasks, lead_sources, push_subscriptions, profiles, report_files, report_print_tokens, contact_notes, campaigns, campaign_recipients,
    tags, contact_tags, professionals, professional_services, chatguru_records, appointments, visits, agenda_blocks, client_packages, package_uses, sales_items, sales_payments, avec_reports,
    cash_movements, comanda_payments, payment_method_options, client_credit_entries, comanda_item_assistants, payment_fees, commission_payouts, professional_adjustments, professional_adjustment_rules, client_debt_entries, comanda_items, comandas, cash_sessions, package_defs, pro_notifications, pro_day_acks, client_notes, client_links
    restart identity cascade`);
  await seed(db);
  await seedTestServices(db);
  await db.insert(users).values([
    { name: "Thaíse Fiaes", email: "gestao@e2e.local", role: "gestor", passwordHash: await hashPassword("senha-e2e-123") },
    { name: "Ana Souza", email: "ana@e2e.local", role: "atendente", passwordHash: await hashPassword("senha-e2e-123") },
  ]);
  // Expediente 24h: os testes não dependem da hora em que rodam (o motor não dispara com a Casa fechada).
  const allDay: [string, string] = ["00:00", "24:00"];
  await db.insert(settings).values({ key: "business_hours", value: { 0: allDay, 1: allDay, 2: allDay, 3: allDay, 4: allDay, 5: allDay, 6: allDay } });
  // Agenda (Lotes 6A+): modo dupla para exercitar tudo; Corte com 60 min; Maiara (9h–18h todo dia) faz Corte; Bia segue o horário da Casa.
  await db.insert(settings).values({ key: "agenda_modo", value: "dupla" });
  // Caixa (Lote 6C): ligado no e2e (em produção fica "avec" até a Casa decidir).
  await db.insert(settings).values({ key: "caixa_modo", value: "crm" });
  // Nota fiscal: em produção o padrão agora é "Perguntar" (a recepção escolhe); o e2e geral segue com "Emitir sem CPF" para não escolher em todo fluxo. O spec do Perguntar troca.
  await db.insert(settings).values({ key: "caixa_regras", value: { notaPadrao: "sem_cpf" } });
  const [corte] = await db.update(lists).set({ durationMin: 60 }).where(and(eq(lists.kind, "service"), eq(lists.label, "Corte"))).returning();
  const nineToSix: [string, string][] = [["09:00", "18:00"]];
  const [maiara] = await db.insert(professionals).values([
    { name: "Maiara", color: "ameixa", agendaPosition: 1, workHours: { 0: nineToSix, 1: nineToSix, 2: nineToSix, 3: nineToSix, 4: nineToSix, 5: nineToSix, 6: nineToSix } },
    { name: "Bia", color: "oceano" },
  ]).returning();
  await db.insert(professionalServices).values({ professionalId: maiara.id, serviceId: corte.id });
  await seedAgendaE2E(db);
  // Lote 7A: a profissional do e2e (perfil Profissional), ligada à Maiara (9h–18h todo dia).
  const [prof] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.key, "profissional"));
  const [maiaraUser] = await db.insert(users).values({ name: "Maiara Lima", email: "maiara@e2e.local", role: "atendente", profileId: prof.id, passwordHash: await hashPassword("senha-e2e-123") })
    .returning({ id: users.id });
  await db.update(professionals).set({ userId: maiaraUser.id }).where(eq(professionals.id, maiara.id));
}
main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
