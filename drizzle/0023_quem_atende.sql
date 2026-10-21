ALTER TABLE "deals" ADD COLUMN "last_reply_by_id" uuid;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "last_reply_via" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sent_via" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_last_reply_by_id_users_id_fk" FOREIGN KEY ("last_reply_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_sent_by_idx" ON "messages" USING btree ("sent_by_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_signature_uq" ON "users" USING btree (upper("signature")) WHERE "users"."signature" is not null;