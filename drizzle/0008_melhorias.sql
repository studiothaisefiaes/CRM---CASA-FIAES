CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TYPE "public"."list_kind" ADD VALUE 'service';--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"prefill" text,
	"referrer_contact_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"options" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"not_before" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid,
	"contact_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"assignee_id" uuid,
	"done_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "deals_one_open_per_contact";--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "wait_key" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "pushed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "quiet_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "last_auto_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "archived_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "source_label" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "paid_cents" integer;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "attendance" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "attendance_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "cycle_days" smallint;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_referrer_contact_id_contacts_id_fk" FOREIGN KEY ("referrer_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_sources_code_uq" ON "lead_sources" USING btree ("code");--> statement-breakpoint
CREATE INDEX "outbox_status_idx" ON "outbox" USING btree ("status","not_before");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "tasks_done_due_idx" ON "tasks" USING btree ("done_at","due_at");--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_archived_stage_id_stages_id_fk" FOREIGN KEY ("archived_stage_id") REFERENCES "public"."stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_service_id_lists_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_wait_uq" ON "alerts" USING btree ("wait_key") WHERE resolved_at is null and wait_key is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "deals_one_open_per_contact" ON "deals" USING btree ("contact_id") WHERE "deals"."closed_at" is null and "deals"."archived_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contacts_name_trgm ON contacts USING gin (name gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_body_trgm ON messages USING gin (body gin_trgm_ops);
