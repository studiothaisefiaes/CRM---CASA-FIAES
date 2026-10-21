CREATE TABLE "client_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"visit_id" uuid NOT NULL,
	"issued_starts_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"first_opened_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"last_action" text,
	"last_action_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_visit_id_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_links" ADD CONSTRAINT "client_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_links_token_uq" ON "client_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_links_visit_idx" ON "client_links" USING btree ("visit_id");