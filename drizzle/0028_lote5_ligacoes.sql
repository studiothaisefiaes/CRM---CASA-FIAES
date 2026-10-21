ALTER TABLE "contact_notes" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "call" jsonb;--> statement-breakpoint
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_notes_message_idx" ON "contact_notes" USING btree ("message_id") WHERE "contact_notes"."message_id" is not null;