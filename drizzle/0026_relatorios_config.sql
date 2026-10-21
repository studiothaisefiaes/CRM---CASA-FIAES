ALTER TABLE "sales_items" ADD COLUMN IF NOT EXISTS "commission_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "sales_items" ADD COLUMN IF NOT EXISTS "commission_cents" integer;--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "visible_profile_ids" uuid[];--> statement-breakpoint
ALTER TABLE "stages" ADD COLUMN IF NOT EXISTS "attempt_days" smallint[];--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "color" text;