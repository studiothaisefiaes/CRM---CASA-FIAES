import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, timestamp, integer, boolean, jsonb, pgEnum, uniqueIndex, index, smallint,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["gestor", "atendente"]);
export const stageKindEnum = pgEnum("stage_kind", ["lead", "atendimento", "agendado", "followup", "fechado", "perdido"]);
export const directionEnum = pgEnum("direction", ["in", "out"]);
export const listKindEnum = pgEnum("list_kind", ["objection", "lost_reason", "quick_reply", "origin"]);
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
  createdAt: createdAt(),
}, (t) => [uniqueIndex("contacts_phone_uq").on(t.phoneE164)]);

export const lists = pgTable("lists", {
  id: id(),
  kind: listKindEnum("kind").notNull(),
  label: text("label").notNull(),
  body: text("body"),
  position: integer("position").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [uniqueIndex("lists_kind_label_uq").on(t.kind, t.label)]);

export const channels = pgTable("channels", {
  id: id(),
  name: text("name").notNull(),
  instanceName: text("instance_name").notNull(),
  status: channelStatusEnum("status").notNull().default("desconectado"),
  phone: text("phone"),
  lastQrAt: timestamp("last_qr_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
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
  createdAt: createdAt(),
}, (t) => [
  index("deals_stage_idx").on(t.stageId),
  index("deals_contact_idx").on(t.contactId),
  index("deals_owner_idx").on(t.ownerId),
  // Nunca dois leads abertos para o mesmo contato.
  uniqueIndex("deals_one_open_per_contact").on(t.contactId).where(sql`${t.closedAt} is null`),
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
}, (t) => [uniqueIndex("alerts_dedupe_uq").on(t.dedupeKey), index("alerts_user_idx").on(t.userId, t.createdAt)]);

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

export type User = typeof users.$inferSelect;
export type Stage = typeof stages.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Deal = typeof deals.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type ListItem = typeof lists.$inferSelect;
