ALTER TABLE "agenda_blocks" ADD COLUMN "origin" text DEFAULT 'avec' NOT NULL;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "buffer_min" smallint;--> statement-breakpoint
ALTER TABLE "professional_services" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_services" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "professional_services" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "work_hours" jsonb;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "professionals" ADD COLUMN "agenda_position" integer;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_blocks" ADD CONSTRAINT "agenda_blocks_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_blocks_live_idx" ON "agenda_blocks" USING btree ("starts_on","ends_on") WHERE "agenda_blocks"."deleted_at" is null;