ALTER TABLE "contacts" ADD COLUMN "avatar_path" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "avatar_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_path" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_mime" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_attempts" smallint DEFAULT 0 NOT NULL;