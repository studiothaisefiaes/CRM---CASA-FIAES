ALTER TYPE "public"."list_kind" ADD VALUE 'keyword';--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "meta" jsonb;