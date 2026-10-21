CREATE TABLE "chatguru_records" (
	"chat_id" text PRIMARY KEY NOT NULL,
	"phone" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "imported_fields" jsonb;