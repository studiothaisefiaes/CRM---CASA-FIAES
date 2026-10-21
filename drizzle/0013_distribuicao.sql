ALTER TABLE "users" ADD COLUMN "availability" text DEFAULT 'ausente' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "availability_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "priority_level" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_assigned_at" timestamp with time zone;