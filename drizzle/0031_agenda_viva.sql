CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid,
	"client_name" text,
	"day" date NOT NULL,
	"deal_id" uuid,
	"notes" text,
	"origin" text DEFAULT 'crm' NOT NULL,
	"request_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "buffer_min" smallint;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "fit_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "fit_in_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "outside_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "any_pro" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmed_via" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancel_note" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_via" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "crm_touched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "avec_twin_of" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "wait_window" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "wait_result_appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "preference" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "photo_path" text;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visits_request_key_uq" ON "visits" USING btree ("request_key") WHERE "visits"."request_key" is not null;--> statement-breakpoint
CREATE INDEX "visits_contact_day_idx" ON "visits" USING btree ("contact_id","day");--> statement-breakpoint
CREATE INDEX "visits_day_idx" ON "visits" USING btree ("day");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_fit_in_by_users_id_fk" FOREIGN KEY ("fit_in_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_avec_twin_of_appointments_id_fk" FOREIGN KEY ("avec_twin_of") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_wait_result_appointment_id_appointments_id_fk" FOREIGN KEY ("wait_result_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_pro_starts_idx" ON "appointments" USING btree ("professional_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_visit_idx" ON "appointments" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "appointments_contact_starts_idx" ON "appointments" USING btree ("contact_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_twin_idx" ON "appointments" USING btree ("avec_twin_of") WHERE "appointments"."avec_twin_of" is not null;