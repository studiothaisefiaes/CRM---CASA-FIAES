CREATE TABLE "contact_stats" (
	"contact_id" uuid PRIMARY KEY NOT NULL,
	"visits" integer DEFAULT 0 NOT NULL,
	"first_visit_on" date,
	"last_visit_on" date,
	"rhythm_days" smallint,
	"cycle_days" smallint,
	"return_due_on" date,
	"no_shows" integer DEFAULT 0 NOT NULL,
	"cancellations" integer DEFAULT 0 NOT NULL,
	"tickets" integer DEFAULT 0 NOT NULL,
	"total_cents" bigint,
	"preferred_professional_id" uuid,
	"preferred_professional_name" text,
	"preferred_share" real,
	"service_count" integer DEFAULT 0 NOT NULL,
	"top_services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin_label" text,
	"avec_professional_hint" text,
	"debt_cents" bigint DEFAULT 0 NOT NULL,
	"debt_count" integer DEFAULT 0 NOT NULL,
	"last_debt_on" date,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "preferred_professional_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "alert_notes" text;--> statement-breakpoint
ALTER TABLE "contact_stats" ADD CONSTRAINT "contact_stats_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_stats" ADD CONSTRAINT "contact_stats_preferred_professional_id_professionals_id_fk" FOREIGN KEY ("preferred_professional_id") REFERENCES "public"."professionals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_stats_return_idx" ON "contact_stats" USING btree ("return_due_on");--> statement-breakpoint
CREATE INDEX "contact_stats_last_visit_idx" ON "contact_stats" USING btree ("last_visit_on");--> statement-breakpoint
CREATE INDEX "contact_stats_pro_idx" ON "contact_stats" USING btree ("preferred_professional_id");--> statement-breakpoint
CREATE INDEX "contact_stats_origin_idx" ON "contact_stats" USING btree ("origin_label");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_preferred_professional_id_professionals_id_fk" FOREIGN KEY ("preferred_professional_id") REFERENCES "public"."professionals"("id") ON DELETE set null ON UPDATE no action;