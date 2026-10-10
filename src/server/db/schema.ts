import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, uniqueIndex, index, smallint,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["gestor", "atendente"]);
export const stageKindEnum = pgEnum("stage_kind", ["lead", "atendimento", "agendado", "followup", "fechado", "perdido"]);
export const directionEnum = pgEnum("direction", ["in", "out"]);
export const listKindEnum = pgEnum("list_kind", ["objection", "lost_reason", "quick_reply", "origin", "service"]);
export const channelStatusEnum = pgEnum("channel_status", ["desconectado", "aguardando_qr", "conectado", "erro"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash"),
  role: roleEnum("role").notNull().default("atendente"),
  active: boolean("active").notNull().default(true),
  inviteTokenHash: text("invite_token_hash"),
  inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)]);

export const sessions = pgTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const stages = pgTable("stages", {
  id: id(),
  key: text("key").notNull(),
  name: text("name").notNull(),
  kind: stageKindEnum("kind").notNull(),
  position: integer("position").notNull(),
  slaMinutes: integer("sla_minutes"),
  staleDays: integer("stale_days"),
  color: text("color").notNull().default("#5c5c5c"),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("stages_key_uq").on(t.key)]);

export const contacts = pgTable("contacts", {
  id: id(),
  name: text("name"),
  phoneE164: text("phone_e164").notNull(),
  email: text("email"),
  instagram: text("instagram"),
  birthDay: smallint("birth_day"),
  birthMonth: smallint("birth_month"),
  birthYear: smallint("birth_year"),
  isClient: boolean("is_client").notNull().default(false),
  clientSince: timestamp("client_since", { withTimezone: true }),
  lastServiceAt: timestamp("last_service_at", { withTimezone: true }),
  notes: text("notes"),
  /** Foto de perfil do WhatsApp baixada (relativo a MEDIA_DIR); avatarCheckedAt evita buscar de novo toda hora. */
  avatarPath: text("avatar_path"),
  avatarCheckedAt: timestamp("avatar_checked_at", { withTimezone: true }),
  /** "Não é cliente" (conversa pessoal, fornecedor): mensagens ficam guardadas, mas não abre lead nem alerta. */
  ignored: boolean("ignored").notNull().default(false),
  /** Última resposta automática de fora do expediente (evita repetir). */
  lastAutoReplyAt: timestamp("last_auto_reply_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("contacts_phone_uq").on(t.phoneE164)]);

export const lists = pgTable("lists", {
  id: id(),
  kind: listKindEnum("kind").notNull(),
  label: text("label").notNull(),
  body: text("body"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
  /** Serviços recorrentes: de quantos em quantos dias a cliente volta (null = sem ciclo). */
  cycleDays: smallint("cycle_days"),
}, (t) => [uniqueIndex("lists_kind_label_uq").on(t.kind, t.label)]);

export const channels = pgTable("channels", {
  id: id(),
  name: text("name").notNull(),
  instanceName: text("instance_name").notNull(),
  status: channelStatusEnum("status").notNull().default("desconectado"),
  phone: text("phone"),
  lastQrAt: timestamp("last_qr_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  /** Silêncio de avisos do canal até esta data. */
  quietUntil: timestamp("quiet_until", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("channels_instance_uq").on(t.instanceName)]);

export const deals = pgTable("deals", {
  id: id(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  stageId: uuid("stage_id").notNull().references(() => stages.id),
  ownerId: uuid("owner_id").references(() => users.id),
  channelId: uuid("channel_id").references(() => channels.id),
  origin: text("origin").notNull().default("whatsapp"),
  valueCents: integer("value_cents"),
  paymentMethod: text("payment_method"),
  objectionId: uuid("objection_id").references(() => lists.id),
  lostReasonId: uuid("lost_reason_id").references(() => lists.id),
  observations: text("observations"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  chargeAt: timestamp("charge_at", { withTimezone: true }),
  recontactAt: timestamp("recontact_at", { withTimezone: true }),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
  awaitingReplySince: timestamp("awaiting_reply_since", { withTimezone: true }),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: uuid("archived_by").references(() => users.id),
  archivedStageId: uuid("archived_stage_id").references(() => stages.id),
  sourceId: uuid("source_id").references(() => leadSources.id),
  sourceLabel: text("source_label"),
  serviceId: uuid("service_id").references(() => lists.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidCents: integer("paid_cents"),
  /** confirmado | compareceu | faltou | remarcou (validado no domínio). */
  attendance: text("attendance"),
  attendanceAt: timestamp("attendance_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index("deals_stage_idx").on(t.stageId),
  index("deals_contact_idx").on(t.contactId),
  index("deals_owner_idx").on(t.ownerId),
  // Nunca dois leads abertos para o mesmo contato.
  uniqueIndex("deals_one_open_per_contact").on(t.contactId).where(sql`${t.closedAt} is null and ${t.archivedAt} is null`),
]);

export const messages = pgTable("messages", {
  id: id(),
  dealId: uuid("deal_id").references(() => deals.id),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  channelId: uuid("channel_id").references(() => channels.id),
  externalId: text("external_id"),
  direction: directionEnum("direction").notNull(),
  kind: text("kind").notNull().default("text"),
  body: text("body"),
  mediaUrl: text("media_url"),
  /** Nó de mídia do WhatsApp ({ key, message }) para baixar o arquivo depois; miniatura incluída. */
  media: jsonb("media").$type<{ key: Record<string, unknown>; message: Record<string, unknown> }>(),
  /** Arquivo baixado (relativo a MEDIA_DIR) e tipo. */
  mediaPath: text("media_path"),
  mediaMime: text("media_mime"),
  mediaAttempts: smallint("media_attempts").notNull().default(0),
  mediaPurgedAt: timestamp("media_purged_at", { withTimezone: true }),
  /** A cliente editou/apagou a mensagem no WhatsApp. */
  editedAt: timestamp("edited_at", { withTimezone: true }),
  /** Trecho da mensagem que esta responde (citação do WhatsApp). */
  quotedBody: text("quoted_body"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  status: text("status").notNull().default("sent"),
  sentByUserId: uuid("sent_by_user_id").references(() => users.id),
  fromPhone: boolean("from_phone").notNull().default(false),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("messages_external_uq").on(sql`coalesce(${t.channelId}::text, '')`, t.externalId).where(sql`${t.externalId} is not null`),
  index("messages_deal_idx").on(t.dealId, t.createdAt),
]);

export const dealEvents = pgTable("deal_events", {
  id: id(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("deal_events_deal_idx").on(t.dealId, t.createdAt), index("deal_events_type_idx").on(t.type, t.createdAt)]);

export const alerts = pgTable("alerts", {
  id: id(),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  audience: text("audience").notNull().default("responsavel"),
  type: text("type").notNull(),
  severity: text("severity").notNull().default("info"),
  message: text("message").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  createdAt: createdAt(),
  readAt: timestamp("read_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** Chave da espera em aberto (um alerta ativo por espera). */
  waitKey: text("wait_key"),
  level: smallint("level").notNull().default(1),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("alerts_dedupe_uq").on(t.dedupeKey),
  index("alerts_user_idx").on(t.userId, t.createdAt),
  uniqueIndex("alerts_wait_uq").on(t.waitKey).where(sql`resolved_at is null and wait_key is not null`),
]);

export const automations = pgTable("automations", {
  id: id(),
  key: text("key"),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  trigger: jsonb("trigger").$type<Record<string, unknown>>().notNull(),
  conditions: jsonb("conditions").$type<Record<string, unknown>[]>().notNull().default([]),
  actions: jsonb("actions").$type<Record<string, unknown>[]>().notNull(),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("automations_key_uq").on(t.key)]);

export const automationVersions = pgTable("automation_versions", {
  id: id(),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  userId: uuid("user_id").references(() => users.id),
  createdAt: createdAt(),
});

export const automationRuns = pgTable("automation_runs", {
  id: id(),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  windowKey: text("window_key").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("automation_runs_uq").on(t.automationId, t.dealId, t.windowKey)]);

export const webhookEvents = pgTable("webhook_events", {
  id: id(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
}, (t) => [uniqueIndex("webhook_events_uq").on(t.provider, t.externalId)]);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

export const leadSources = pgTable("lead_sources", {
  id: id(),
  /** 6–12 caracteres [a-z0-9]. */
  code: text("code").notNull(),
  label: text("label").notNull(),
  /** instagram | google | panfleto | indicacao | anuncio | recepcao | outro */
  kind: text("kind").notNull(),
  prefill: text("prefill"),
  referrerContactId: uuid("referrer_contact_id").references(() => contacts.id),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("lead_sources_code_uq").on(t.code)]);

export const tasks = pgTable("tasks", {
  id: id(),
  dealId: uuid("deal_id").references(() => deals.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  /** proxima_acao | retorno | comparecimento | geral */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  assigneeId: uuid("assignee_id").references(() => users.id),
  doneAt: timestamp("done_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("tasks_done_due_idx").on(t.doneAt, t.dueAt)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
}, (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint)]);

export const outbox = pgTable("outbox", {
  id: id(),
  dealId: uuid("deal_id").notNull().references(() => deals.id, { onDelete: "cascade" }),
  /** text | poll */
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  /** Opções da enquete (lista) ou { values, source, ... }: `source` diz de onde veio ("automacao:<id>" | "auto_resposta") e `awaiting` / `scheduledAt` / `stage` guardam o que valia ao enfileirar, para reconferir na hora de enviar. */
  options: jsonb("options").$type<string[] | { values?: string[]; source?: string; awaiting?: string; scheduledAt?: string; stage?: string } | null>(),
  /** pending | sending | sent | failed | cancelled */
  status: text("status").notNull().default("pending"),
  notBefore: timestamp("not_before", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  error: text("error"),
  attempts: smallint("attempts").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("outbox_status_idx").on(t.status, t.notBefore)]);

export type User = typeof users.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type ListItem = typeof lists.$inferSelect;
export type LeadSource = typeof leadSources.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type OutboxItem = typeof outbox.$inferSelect;
