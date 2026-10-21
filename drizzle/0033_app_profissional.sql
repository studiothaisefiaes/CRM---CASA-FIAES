CREATE TABLE "client_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"professional_id" uuid,
	"appointment_id" uuid,
	"body" text NOT NULL,
	"media_path" text,
	"media_mime" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "client_notes_body_len" CHECK (length("client_notes"."body") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "pro_day_acks" (
	"professional_id" uuid NOT NULL,
	"day" date NOT NULL,
	"acked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acked_by" uuid NOT NULL,
	CONSTRAINT "pro_day_acks_professional_id_day_pk" PRIMARY KEY("professional_id","day")
);
--> statement-breakpoint
CREATE TABLE "pro_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"appointment_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"hold_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pushed_at" timestamp with time zone,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "request_status" text;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_day_acks" ADD CONSTRAINT "pro_day_acks_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_day_acks" ADD CONSTRAINT "pro_day_acks_acked_by_users_id_fk" FOREIGN KEY ("acked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_notifications" ADD CONSTRAINT "pro_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_notifications" ADD CONSTRAINT "pro_notifications_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_notifications" ADD CONSTRAINT "pro_notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_notes_contact_idx" ON "client_notes" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pro_notifications_dedupe_uq" ON "pro_notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "pro_notifications_pending_idx" ON "pro_notifications" USING btree ("pushed_at","hold_until");--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "professionals_user_uq" ON "professionals" USING btree ("user_id") WHERE "professionals"."user_id" is not null;